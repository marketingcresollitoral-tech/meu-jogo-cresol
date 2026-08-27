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

async function generateAIAdvice(playerA, playerB) {
  const promptText = `Você é um gerador de diálogos curtos para um jogo de gamificação bancária da Cresol Litoral.
Dois gerentes se encontraram:
- ${playerA.name}
- ${playerB.name}

Gere uma nova dica prática curta (uma frase para cada) sobre acionamentos de cobrança, redução de provisão ou metas de inadimplência.
Responda EXCLUSIVAMENTE em formato JSON com o nome de cada um como chave. Exemplo:
{"${playerA.name}": "Texto aqui", "${playerB.name}": "Texto aqui"}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: promptText,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Erro na chamada Gemini:", error);
    const fallbackTips = [
      { [playerA.name]: "Como está a carteira essa semana?", [playerB.name]: "Focando nos acionamentos de 1 a 30 dias!" },
      { [playerA.name]: "Qual a dica pra atingir o topo do ranking?", [playerB.name]: "Regularizar o INAD 90 nos primeiros 7 dias dá bônus de XP!" },
      { [playerA.name]: "Bora bater a meta coletiva?", [playerB.name]: "Se a cooperativa fechar 100%, libera o bônus pra todo mundo!" }
    ];
    return fallbackTips[Math.floor(Math.random() * fallbackTips.length)];
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

  socket.on('leaveConversation', () => {
    const p1 = players[socket.id];
    if (p1) {
      const p2 = players[p1.pairId];
      p1.inConversation = false;
      const oldPair = p1.pairId;
      p1.pairId = null;

      if (p2) {
        p2.inConversation = false;
        p2.pairId = null;
      }
      io.emit('endConversation', { p1Id: socket.id, p2Id: oldPair });
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
