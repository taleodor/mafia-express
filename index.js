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

    socket.on('shufflecards', function (shuffleObj) {
        // verify that user is admin
        let curUser = gameStatus[shuffleObj.room].find(p => (p.id === socket.id))
        if (curUser.admin) {
            let cardList = []
            // construct card list
            Object.keys(shuffleObj.cards).forEach(type => {
                for (let i=0; i < Number(shuffleObj.cards[type]); i++) {
                    cardList.push(type)
                }
            })
            // shuffle card list
            shuffle(cardList)
            console.log(cardList)
            
            // assign cards to players
            for (let i=0; i < cardList.length; i++) {
                gameStatus[shuffleObj.room][i].card = cardList[i]
                io.to(gameStatus[shuffleObj.room][i].id).emit('cardassigned', cardList[i])
            }
            console.log(gameStatus[shuffleObj.room])
        }
    })
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

/**
 * Shuffles array in place. ES6 version
 * @param {Array} a items An array containing the items.
 * https://stackoverflow.com/questions/6274339/how-can-i-shuffle-an-array
 */
function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
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
        // first player in the room becomes admin
        player.admin = true
        gameStatus[player.room] = [player]
        io.to(player.id).emit('youareadmin');
    }
}

http.listen(3000, function(){
    console.log('listening on *:3000 2');
});