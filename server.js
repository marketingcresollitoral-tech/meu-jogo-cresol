// Instalar dependências: npm install express socket.io @google/genai
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Inicialize o SDK do Gemini (defina a variável GEMINI_API_KEY no ambiente)
const ai = new GoogleGenAI();

app.use(express.static('public'));

// Guarda os jogadores ativos no servidor
let players = {};

// Função para gerar conversa via IA quando 2 gerentes se cruzam
async function generateAIConversation(playerA, playerB) {
  const prompt = `Você é um gerador de diálogos curtos para um jogo 16-bit de gamificação bancária.
Dois gerentes de conta se encontraram no mapa do jogo:
- Jogador 1: ${playerA.name} (Agência: ${playerA.role})
- Jogador 2: ${playerB.name} (Agência: ${playerB.role})

Crie um diálogo extremamente curto e descontraído (máximo 2 frases por pessoa) no tom de piada de trabalho/motivação sobre bater metas, diminuir provisão, ou acionamentos de cobrança. Responda em formato JSON.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text);
  } catch (error) {
    return {
      [playerA.name]: "E aí, parça! Como estão as metas por aí?",
      [playerB.name]: "Trabalhando firme para zerar a provisão hoje!"
    };
  }
}

io.on('connection', (socket) => {
  console.log('Novo jogador conectado:', socket.id);

  // Evento de Entrada/Login
  socket.on('joinGame', (playerData) => {
    players[socket.id] = {
      id: socket.id,
      name: playerData.name,
      role: playerData.role,
      color: playerData.color,
      x: 100 + Math.random() * 200,
      y: 300 + Math.random() * 100,
      inConversation: false
    };

    // Notifica todos sobre os jogadores conectados
    io.emit('updatePlayers', players);
  });

  // Movimentação em tempo real
  socket.on('move', (position) => {
    if (players[socket.id]) {
      players[socket.id].x = position.x;
      players[socket.id].y = position.y;

      // Checa colisão entre jogadores online
      checkPlayerCollisions(socket.id);

      // Transmite a nova posição para todos os outros
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  // Desconexão
  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// Checar esbarrão entre avatares
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

      // Distância de esbarrão (30px)
      if (dist < 30) {
        p1.inConversation = true;
        p2.inConversation = true;

        // Gera diálogo com IA
        const dialog = await generateAIConversation(p1, p2);

        // Transmite o balão de conversa para todos
        io.emit('triggerConversation', {
          p1Id: p1.id,
          p2Id: p2.id,
          dialog: dialog
        });

        // Libera a movimentação após 6 segundos
        setTimeout(() => {
          if (players[p1.id]) players[p1.id].inConversation = false;
          if (players[p2.id]) players[p2.id].inConversation = false;
          io.emit('endConversation', { p1Id: p1.id, p2Id: p2.id });
        }, 6000);
      }
    }
  }
}

server.listen(3000, () => console.log('Servidor rodando em http://localhost:3000'));