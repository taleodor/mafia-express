var app = require('express')();
var http = require('http').createServer(app);
var io  = require('socket.io')(http, { path: '/api'});

var gameStatus = {}  // room -> players -> name, role, seat

app.get('/api', function(req, res){
    res.send('<h1>Hello world</h1>');
});

io.on('connection', function(socket){
    console.log('a user connected');

    socket.on('joinroom', function (data) {
        console.log(data)
        console.log(data.name + ' joined room ' + data.room)
        socket.join(data.room)
        socket.to(data.room).emit('joinedroom', data.name)
        data.id = socket.id
        updateGameStatus(data)
        sendPlayerList(data.room)
        console.log(gameStatus)
    });

    socket.on('requestroom', function (room) {
        sendPlayerList(room, socket.id)
    })

    socket.on('disconnect', function () {
        setTimeout(function () {
             //do something
        }, 5000);
    });
});

function sendPlayerList (room, id) {
    let target = id ? id : room
    let playerList = []
    if (gameStatus[room]) {
        gameStatus[room].forEach(p => {
            playerList.push(p.name)
        })
    }
    io.to(target).emit('playerlist', playerList)
}

function updateGameStatus (player) {
    if (gameStatus[player.room]) {
        let proceed = true
        let existingPlayer = gameStatus[player.room].find(p => (p.name === player.name))
        // if name matches but id doesn't match, infom player that id is taken
        // if id matches, and player name matches, don't do anything
        // if id matches but player name is different update name
        if (existingPlayer && existingPlayer.id !== player.id) {
            io.to(player.id).emit('nametaken');
            proceed = false
        }

        let sameIdPlayer = gameStatus[player.room].find(p => (p.id === player.id))
        if (proceed && sameIdPlayer && sameIdPlayer.id === player.id && sameIdPlayer.name !== player.name) {
            sameIdPlayer.name = player.name
            proceed = false
        }
        // only append if this name is not in the room yet
        if (proceed && !gameStatus[player.room].find(p => (p.name === player.name))) {
            gameStatus[player.room].push(player)
        }
    } else {
        gameStatus[player.room] = [player]
    }
}

http.listen(3000, function(){
    console.log('listening on *:3000');
});