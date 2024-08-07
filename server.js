const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: ["https://chess-pro.vercel.app", "http://localhost:5173"],
    methods: ["GET", "POST"]
  }
});


const rooms = {}; // Assuming you have this global object to keep track of rooms
let online_players = 0;
const match_requested_players = [];

function findMatchingPlayer(queue, playerData) {
  for (const player of queue) {
    if (player.seconds === playerData.seconds && player.id !== playerData.id) {
      return player;
    }
  }

  return null; // No suitable match found
}

io.on("connection", (socket) => {
  online_players += 1;
  io.emit("updateOnlinePlayers", online_players);

  socket.on("create_room", (roomId, playerName, callback) => {
    // Check If the user Already exists in the room
    let isSamePlayer = false;
    rooms[roomId]?.players?.forEach((player) => {
      if (player.id === socket.id) {
        isSamePlayer = true;
      }
    });
    if (isSamePlayer) {
      return;
    }

    // Check if the room already exists and is full
    if (rooms[roomId] && rooms[roomId].players.length === 2) {
      callback({ success: false, message: "Room is full" });
      return;
    }

    // If the room doesn't exist, create it
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [] };
    }

    // Assign side to the joining player
    const assignedSide = rooms[roomId].players.length === 0 ? "white" : "black";
    rooms[roomId].players.push({
      id: socket.id,
      side: assignedSide,
      name: playerName,
    });

    // Join the room
    socket.join(roomId);

    // Emit userconnected event to all users in the room
    io.to(roomId).emit("userconnected", {
      success: true,
      players: rooms[roomId].players,
    });

    // Send success callback with room ID, assigned side, and number of users in the room
    callback({
      success: true,
      roomId: roomId,
      side: assignedSide,
      name: playerName,
      usersInRoom: rooms[roomId].players.length,
    });
  });

  socket.on("matching_queue", (data, callback) => {
    // When a user calls this push them into the requested match players array
    match_requested_players.push(data);

    const potentialMatch = findMatchingPlayer(match_requested_players, data);
    if (potentialMatch) {
      console.log("player1Id:", data.id, "Player2Id", potentialMatch.id);
      const roomId =
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);

      // Remove The Players from the macthing list
      match_requested_players.splice(match_requested_players.indexOf(data), 1);
      match_requested_players.splice(
        match_requested_players.indexOf(potentialMatch),
        1
      );

      io.to(socket.id).emit("game_found", {
        roomId: roomId,
        seconds: data.seconds,
      });
      io.to(potentialMatch.id).emit("game_found", {
        roomId: roomId,
        seconds: potentialMatch.seconds,
      });
    } else {
      // No match found yet, queue the player
      callback({ success: true, message: "Waiting for opponent..." });
    }
  });

  socket.on("rematch", (roomId) => {
    console.log("Server Rematch Requested");
    io.to(roomId).emit("sendrematch");
  });

  socket.on("getUsers", (roomId, callback) => {
    if (rooms[roomId]) {
      socket.to(roomId).emit("userconnected", {
        success: true,
        players: rooms[roomId].players,
      });
      callback({
        success: true,
        players: rooms[roomId].players,
      });
    } else {
      callback({
        success: false,
        message: "Room not found",
      });
    }
  });

  socket.on("move", (move, roomId) => {
    console.log(roomId);
    socket.to(roomId).emit("opponentMoved", move);
  });

  socket.on("gameover", (roomId) => {
    socket.to(roomId).emit("gameover");
  });

  socket.on("resign", (roomId, side) => {
    console.log(roomId, side);
    io.to(roomId).emit("sendresign", { side, type: "Resigned" });
  });

  socket.on("disconnect", () => {
    // Find the room the user is in and remove them from it
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(
        (player) => player.id === socket.id
      );
      if (playerIndex !== -1) {
        const player = room.players[playerIndex]; // Capture the player object
        room.players.splice(playerIndex, 1);
        // Trigger event for user leaving the room
        io.to(roomId).emit("sendresign", { side: player.side, type: "Left" });
        // If the room is empty, delete it
        if (room.players.length === 0) {
          delete rooms[roomId];
        }
        break;
      }
    }
    online_players -= 1;
    io.emit("updateOnlinePlayers", online_players);
  });
});


const port = process.env.PORT || 3000;
httpServer.listen(port, () => {
  console.log(`Server running on port http://localhost:${port}`);
});

// Add a basic route for health check
app.get('/', (req, res) => {
  res.send('Chess Pro Server is running');
});

module.exports = app; // This is important for Vercel