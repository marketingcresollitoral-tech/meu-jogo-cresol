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
// Armazena o histórico da conversa entre cada dupla de jogadores
let activeHistories = {};

// Função para gerar conversação real encadeada usando a IA
async function generateContinuousAIConversation(playerA, playerB, historyKey) {
  if (!activeHistories[historyKey]) {
    activeHistories[historyKey] = [];
  }

  const historyText = activeHistories[historyKey].length > 0 
    ? `Histórico das falas anteriores:\n` + activeHistories[historyKey].map(h => `${h.speaker}: "${h.text}"`).join('\n')
    : `Esta é a primeira vez que eles se encontram hoje.`;

  const promptText = `Você é um roteirista de diálogos dinâmicos para um jogo de RPG gamificado da Cresol Litoral.
Dois gerentes de carteira estão conversando no mapa:
- ${playerA.name} (${playerA.role})
- ${playerB.name} (${playerB.role})

${historyText}

Gere o PRÓXIMO PASSO dessa conversa. O Personagem 1 deve falar algo (ou responder à última fala) e o Personagem 2 deve responder diretamente ao que foi dito.
Importante: O diálogo deve ser natural, sobre rotina bancária, metas de cobrança, provisão, piadas leves de escritório ou troca de conselhos de negociação.

Responda ESTRITAMENTE em formato JSON com o nome de cada um como chave:
{"${playerA.name}": "Fala do Personagem 1", "${playerB.name}": "Resposta contextualizada do Personagem 2"}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: promptText,
      config: { responseMimeType: "application/json" }
    });

    const result = JSON.parse(response.text);

    // Guarda no histórico local para a próxima rodada lembrar
    if (result[playerA.name]) activeHistories[historyKey].push({ speaker: playerA.name, text: result[playerA.name] });
    if (result[playerB.name]) activeHistories[historyKey].push({ speaker: playerB.name, text: result[playerB.name] });

    // Mantém no máximo as últimas 6 falas no histórico para não pesar a memória
    if (activeHistories[historyKey].length > 6) {
      activeHistories[historyKey] = activeHistories[historyKey].slice(-6);
    }

    return result;
  } catch (error) {
    console.error("Erro na API da IA:", error);
    return {
      [playerA.name]: "O sistema deu uma oscilada... Mas e aí, como tá a carteira?",
      [playerB.name]: "Tranquilo! Tô focado em zerar a provisão hoje."
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

  // AVANÇAR O DIÁLOGO (Apertar E / Enter / Clique)
  socket.on('nextDialogue', async () => {
    const p1 = players[socket.id];
    if (p1 && p1.pairId && players[p1.pairId]) {
      const p2 = players[p1.pairId];
      const historyKey = [p1.id, p2.id].sort().join('_');

      const dialog = await generateContinuousAIConversation(p1, p2, historyKey);
      io.emit('triggerConversation', {
        p1Id: p1.id,
        p2Id: p2.id,
        dialog: dialog
      });
    }
  });

  // SAIR DA CONVERSA (Pressionar ESC)
  socket.on('leaveConversation', () => {
    const p1 = players[socket.id];
    if (p1 && p1.pairId) {
      const p2 = players[p1.pairId];
      const historyKey = [p1.id, p1.pairId].sort().join('_');

      // Limpa o histórico de diálogos dessa conversa
      delete activeHistories[historyKey];

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

      if (dist < 38) {
        p1.inConversation = true;
        p1.pairId = p2.id;
        p2.inConversation = true;
        p2.pairId = p1.id;

        const historyKey = [p1.id, p2.id].sort().join('_');
        const dialog = await generateContinuousAIConversation(p1, p2, historyKey);

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
