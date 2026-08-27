const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Usa a chave do ambiente (configurada nas Environment Variables do Render)
const ai = new GoogleGenAI();

app.use(express.static('public'));

let players = {};
let activeConversations = {};

// Função para gerar diálogos e dicas via IA do Gemini
async function generateAIAdvice(playerA, playerB) {
  const prompt = `Você é um gerador de diálogos para um jogo de gamificação bancária.
Dois gerentes se encontraram no mapa:
- ${playerA.name} (${playerA.role})
- ${playerB.name} (${playerB.role})

Gere um diálogo muito curto (1 frase para cada) onde um pede ou dá uma dica prática sobre como bater metas de cobrança, zerar provisão de carteira ou recuperar inadimplência. Responda ESTRITAMENTE em formato JSON. Exemplo:
{"${playerA.name}": "Dica de fala aqui", "${playerB.name}": "Dica de resposta aqui"}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text);
  } catch (error) {
    return {
      [playerA.name]: "Qual sua estratégia para o INAD 90 essa semana?",
      [playerB.name]: "Foco total em regularizar nos primeiros 7 dias para ganhar o bônus de agilidade!"
    };
  }
}

io.on('connection', (socket) => {
  socket.on('joinGame', (playerData) => {
    players[socket.id] = {
      id: socket.id,
      name: playerData.name,
      role: playerData.role || 'Gerente',
      color: playerData.color,
      x: 200 + Math.random() * 200,
      y: 200 + Math.random() * 100,
      inConversation: false,
      pairId: null
    };
    io.emit('updatePlayers', players);
  });

  socket.on('move', (position) => {
    if (players[socket.id] && !players[socket.id].inConversation) {
      players[socket.id].x = position.x;
      players[socket.id].y = position.y;
      checkPlayerCollisions(socket.id);
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  // Evento acionado ao apertar ESPAÇO durante uma conversa
  socket.on('nextDialogue', async () => {
    const p1 = players[socket.id];
    if (p1 && p1.inConversation && p1.pairId) {
      const p2 = players[p1.pairId];
      if (p2) {
        const dialog = await generateAIAdvice(p1, p2);
        io.emit('triggerConversation', {
          p1Id: p1.id,
          p2Id: p2.id,
          dialog: dialog
        });
      }
    }
  });

  // Encerrar conversa e voltar a andar
  socket.on('leaveConversation', () => {
    const p1 = players[socket.id];
    if (p1 && p1.pairId) {
      const p2 = players[p1.pairId];
      p1.inConversation = false;
      p1.pairId = null;
      if (p2) {
        p2.inConversation = false;
        p2.pairId = null;
      }
      io.emit('endConversation', { p1Id: socket.id, p2Id: p1.pairId });
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

async function checkPlayerCollisions(currentSocketId) {
  const p1 = players[currentSocketId];
  if (!p1 || p1.inConversation) return;

  for (let id in players) {
    if (id !== currentSocketId) {
      const p2 = players[id];
      if (!p2 || p2.inConversation) continue;

      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 35) {
        p1.inConversation = true;
        p1.pairId = p2.id;
        p2.inConversation = true;
        p2.pairId = p1.id;

        const dialog = await generateAIAdvice(p1, p2);
        io.emit('triggerConversation', {
          p1Id: p1.id,
          p2Id: p2.id,
          dialog: dialog
        });
      }
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
