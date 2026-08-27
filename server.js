const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const ai = new GoogleGenAI();

app.use(express.static('public'));

let players = {};

// Função para gerar dicas dinâmicas com IA do Gemini
async function generateAIAdvice(playerA, playerB) {
  const promptText = `Você é um gerador de diálogos para um jogo de gamificação bancária.
Dois gerentes de carteira se encontraram:
1. ${playerA.name} (${playerA.role})
2. ${playerB.name} (${playerB.role})

Gere um diálogo novo, curto e descontraído (uma frase para cada) com dicas reais sobre cobrança de dívidas, meta de acionamento ou provisão de carteira.
Retorne EXCLUSIVAMENTE um objeto JSON válido onde as chaves são os nomes exatos:
{"${playerA.name}": "Frase do primeiro", "${playerB.name}": "Frase do segundo"}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: promptText,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Erro na IA:", error);
    const fallbackTips = [
      { [playerA.name]: "Qual sua estratégia de cobrança hoje?", [playerB.name]: "Focando nos contratos de 1 a 30 dias de atraso!" },
      { [playerA.name]: "Como ganhar bônus de XP rápido?", [playerB.name]: "Regularizar o INAD 90 nos primeiros 7 dias dá bônus de agilidade!" },
      { [playerA.name]: "Bora bater a meta da cooperativa?", [playerB.name]: "Se fechar 100%, destrava o prêmio pra todo mundo!" }
    ];
    return fallbackTips[Math.floor(Math.random() * fallbackTips.length)];
  }
}

// Localiza o parceiro de conversa do jogador atual
function findPartner(p1SocketId) {
  const p1 = players[p1SocketId];
  if (!p1) return null;

  // Se tiver um pairId válido, retorna ele
  if (p1.pairId && players[p1.pairId]) {
    return players[p1.pairId];
  }

  // Busca por proximidade física (< 40px) se o pairId se perdeu
  for (let id in players) {
    if (id !== p1SocketId) {
      const p2 = players[id];
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      if (Math.sqrt(dx * dx + dy * dy) < 40) {
        p1.pairId = p2.id;
        p2.pairId = p1.id;
        return p2;
      }
    }
  }
  return null;
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

  // AVANÇAR DIÁLOGO (Via Clique ou ESPAÇO)
  socket.on('nextDialogue', async () => {
    const p1 = players[socket.id];
    if (p1) {
      const p2 = findPartner(socket.id);
      if (p2) {
        p1.inConversation = true;
        p2.inConversation = true;
        
        const dialog = await generateAIAdvice(p1, p2);
        io.emit('triggerConversation', {
          p1Id: p1.id,
          p2Id: p2.id,
          dialog: dialog
        });
      }
    }
  });

  // SAIR DA CONVERSA (ESC)
  socket.on('leaveConversation', () => {
    const p1 = players[socket.id];
    if (p1) {
      const p2 = findPartner(socket.id);
      p1.inConversation = false;
      p1.pairId = null;

      if (p2) {
        p2.inConversation = false;
        p2.pairId = null;
        io.emit('endConversation', { p1Id: p1.id, p2Id: p2.id });
      } else {
        io.emit('endConversation', { p1Id: p1.id });
      }
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

  const p2 = findPartner(currentSocketId);
  if (p2 && !p2.inConversation) {
    p1.inConversation = true;
    p2.inConversation = true;

    const dialog = await generateAIAdvice(p1, p2);
    io.emit('triggerConversation', {
      p1Id: p1.id,
      p2Id: p2.id,
      dialog: dialog
    });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
