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
let activeSessions = {};

// Gera a réplica baseada estritamente no histórico da dupla
async function generateNextTurnSpeech(speaker, listener, historyText) {
  const promptText = `Você é um roteirista de um jogo corporativo gamificado para a Cresol Litoral.
Dois gerentes estão conversando:
- ${speaker.name} (${speaker.role})
- ${listener.name} (${listener.role})

${historyText}

O último a falar foi ${listener.name}. Agora é a VEZ EXCLUSIVA de ${speaker.name} responder diretamente ao que foi dito acima.
Gere APENAS a frase curta de ${speaker.name} (no máximo 15 palavras), de forma natural, profissional ou descontraída.

Responda EXCLUSIVAMENTE um JSON com este formato:
{"speech": "Sua frase de resposta aqui"}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: promptText,
      config: { responseMimeType: "application/json" }
    });
    const result = JSON.parse(response.text);
    return result.speech || "Vamos pra cima bater essa meta!";
  } catch (error) {
    console.error("Erro na IA:", error);
    return "Com certeza! Foco total em organizar a carteira essa semana.";
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
      sessionId: null
    };
    io.emit('updatePlayers', players);
  });

  socket.on('move', (position) => {
    const p = players[socket.id];
    if (p && !p.inConversation) {
      p.x = position.x;
      p.y = position.y;
      socket.broadcast.emit('playerMoved', p);
      checkCollisions(socket.id);
    }
  });

  // AVANÇAR TURNOS (Aceita ordem de qualquer um dos dois participantes)
  socket.on('nextDialogue', async () => {
    const p = players[socket.id];
    if (!p || !p.sessionId || !activeSessions[p.sessionId]) return;

    const session = activeSessions[p.sessionId];
    
    // Inverte o turno: o ouvinte vira o próximo orador
    const currentSpeakerId = session.nextSpeakerId;
    const currentListenerId = currentSpeakerId === session.p1Id ? session.p2Id : session.p1Id;
    
    const speaker = players[currentSpeakerId];
    const listener = players[currentListenerId];

    if (!speaker || !listener) return;

    const historyFormatted = session.history.length > 0
      ? `Histórico da conversa:\n` + session.history.map(h => `${h.speaker}: "${h.text}"`).join('\n')
      : `O diálogo está começando agora.`;

    const nextSpeech = await generateNextTurnSpeech(speaker, listener, historyFormatted);
    
    // Salva no histórico da sessão
    session.history.push({ speaker: speaker.name, text: nextSpeech });
    if (session.history.length > 6) session.history.shift();

    // Prepara o próximo turno para o parceiro
    session.nextSpeakerId = currentListenerId;

    // Transmite a nova mensagem para ambos os navegadores
    io.emit('updateConversationStep', {
      sessionId: session.id,
      speakerId: speaker.id,
      speakerName: speaker.name,
      speech: nextSpeech,
      nextTurnName: listener.name
    });
  });

  // SAIR DA CONVERSA (Descongela e permite andar livremente)
  socket.on('leaveConversation', () => {
    const p1 = players[socket.id];
    if (p1 && p1.sessionId && activeSessions[p1.sessionId]) {
      const session = activeSessions[p1.sessionId];
      const p2 = players[session.p1Id === p1.id ? session.p2Id : session.p1Id];

      p1.inConversation = false;
      p1.sessionId = null;

      if (p2) {
        p2.inConversation = false;
        p2.sessionId = null;
      }

      delete activeSessions[session.id];
      io.emit('endConversation', { p1Id: p1.id, p2Id: p2 ? p2.id : null });
    }
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p && p.sessionId && activeSessions[p.sessionId]) {
      const session = activeSessions[p.sessionId];
      delete activeSessions[session.id];
      io.emit('endConversation', { p1Id: session.p1Id, p2Id: session.p2Id });
    }
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

async function checkCollisions(activeId) {
  const p1 = players[activeId];
  if (!p1 || p1.inConversation) return;

  for (let id in players) {
    if (id !== activeId) {
      const p2 = players[id];
      if (!p2 || p2.inConversation) continue;

      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 40) {
        const sessionId = `session_${p1.id}_${p2.id}_${Date.now()}`;
        
        p1.inConversation = true;
        p1.sessionId = sessionId;
        p2.inConversation = true;
        p2.sessionId = sessionId;

        activeSessions[sessionId] = {
          id: sessionId,
          p1Id: p1.id,
          p2Id: p2.id,
          nextSpeakerId: p2.id, // p1 começa falando, p2 será o próximo
          history: [{ speaker: p1.name, text: "E aí, parça! Como estão as metas da sua carteira por aí?" }]
        };

        // Dispara o evento inicial
        io.emit('startConversation', {
          sessionId: sessionId,
          p1Id: p1.id,
          p2Id: p2.id,
          initialSpeakerId: p1.id,
          initialSpeech: "E aí, parça! Como estão as metas da sua carteira por aí?",
          nextTurnName: p2.name
        });
        break;
      }
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
