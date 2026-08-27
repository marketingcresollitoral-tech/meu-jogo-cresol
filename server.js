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
let conversationIntervals = {};

// Função para gerar dicas dinâmicas com a IA do Gemini
async function generateAIAdvice(playerA, playerB) {
  const promptText = `Você é um gerador de diálogos curtos para um jogo de gamificação bancária da Cresol Litoral.
Dois gerentes se encontraram:
- ${playerA.name} (${playerA.role})
- ${playerB.name} (${playerB.role})

Gere uma dica rápida, motivacional ou de cobrança/provisão (uma frase curta para cada).
Responda EXCLUSIVAMENTE em formato JSON com o nome de cada um como chave:
{"${playerA.name}": "Texto da primeira fala", "${playerB.name}": "Texto da segunda fala"}`;

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
      { [playerA.name]: "Como está a carteira essa semana?", [playerB.name]: "Focando nos acionamentos de 1 a 30 dias!" },
      { [playerA.name]: "Como ganhar bônus de XP rápido?", [playerB.name]: "Regularizar o INAD 90 nos primeiros 7 dias dá bônus de agilidade!" },
      { [playerA.name]: "Bora bater a meta coletiva?", [playerB.name]: "Se fechar 100%, libera o prêmio pra todo mundo!" }
    ];
    return fallbackTips[Math.floor(Math.random() * fallbackTips.length)];
  }
}

// Inicia a conversa automática que se repete a cada 4.5 segundos
function startAutoConversation(p1, p2) {
  const convId = [p1.id, p2.id].sort().join('_');
  if (conversationIntervals[convId]) return;

  async function triggerNextStep() {
    if (!players[p1.id] || !players[p2.id]) {
      stopAutoConversation(convId);
      return;
    }
    const dialog = await generateAIAdvice(p1, p2);
    io.emit('triggerConversation', {
      p1Id: p1.id,
      p2Id: p2.id,
      dialog: dialog
    });
  }

  // Dispara a primeira fala na hora
  triggerNextStep();

  // Mantém a conversa fluindo sozinha
  conversationIntervals[convId] = setInterval(triggerNextStep, 4500);
}

function stopAutoConversation(convId) {
  if (conversationIntervals[convId]) {
    clearInterval(conversationIntervals[convId]);
    delete conversationIntervals[convId];
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

  // Liberar a conversa ao apertar ESC
  socket.on('leaveConversation', () => {
    const p1 = players[socket.id];
    if (p1 && p1.pairId) {
      const p2 = players[p1.pairId];
      const convId = [p1.id, p1.pairId].sort().join('_');
      stopAutoConversation(convId);

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

function checkPlayerCollisions(currentSocketId) {
  const p1 = players[currentSocketId];
  if (!p1 || p1.inConversation) return;

  for (let id in players) {
    if (id !== currentSocketId) {
      const p2 = players[id];
      if (!p2 || p2.inConversation) continue;

      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 38) {
        p1.inConversation = true;
        p1.pairId = p2.id;
        p2.inConversation = true;
        p2.pairId = p1.id;

        startAutoConversation(p1, p2);
      }
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
