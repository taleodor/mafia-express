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
        console.log(data.name + ', uuid = ' + data.uuid + ' joined room ' + data.room)
        socket.join(data.room)
        socket.to(data.room).emit('joinedroom', data.name)
        data.id = socket.id
        updateGameStatus(data)
        sendPlayerList(data.room)
        // console.log(gameStatus)
    });

    socket.on('kickplayer', kickobj => {
        // verify that user is admin
        let curUser = gameStatus[kickobj.room].find(p => (p.id === socket.id))
        if (curUser.admin) {
            gameStatus[kickobj.room] = gameStatus[kickobj.room].filter(p => (p.name !== kickobj.name))
            sendPlayerList(kickobj.room)
            socket.to(kickobj.room).emit('adminmsg', 'player ' + kickobj.name + ' has been removed by Game Master!')
        }
    })

    socket.on('requestroom', function (roomobj) {
        // if this uuid is in the list, update id with current player
        if (gameStatus[roomobj.room]) {
            let curUser = gameStatus[roomobj.room].find(p => (p.uuid === roomobj.uuid))
            if (curUser) {
                curUser.id = socket.id
                if (curUser.admin) {
                    io.to(curUser.id).emit('youareadmin')
                }
            }
        }
        sendPlayerList(roomobj.room, socket.id)
    })

    socket.on('updateorder', orderobj => {
        // verify that user is admin
        let curUser = gameStatus[orderobj.room].find(p => (p.id === socket.id))
        if (curUser.admin) {
            let updUser = gameStatus[orderobj.room].find(p => (p.name === orderobj.player))
            updUser.order = orderobj.order
            let updObj = {
                name: updUser.name,
                order: updUser.order
            }
            io.to(orderobj.room).emit('orderchanged', updObj)
            sendPlayerList(orderobj.room)
        }
    })

    socket.on('shuffleorder', room => {
        // verify that user is admin
        let curUser = gameStatus[room].find(p => (p.id === socket.id))
        if (curUser.admin) {
            let orderList = []
            // construct order list
            gameStatus[room].forEach(player => {
                orderList.push(player.order)
            })
            // shuffle order list
            shuffle(orderList)
            console.log('shuffled order list, new list = ' + orderList)
            
            // assign new orders to players
            for (let i=0; i < orderList.length; i++) {
                gameStatus[room][i].order = orderList[i]
            }
            io.to(room).emit('ordershuffled')
            sendPlayerList(room)
            console.log(gameStatus[room])
        }
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
            let pObj = {
                name: p.name,
                order: p.order
            }
            playerList.push(pObj)
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
            // compute player order - next available
            let order = 1
            let orderResolved = -1
            for (let i=0; i < gameStatus[player.room].length + 1 && orderResolved < 0; i++) {
                let orderPresent = false
                gameStatus[player.room].forEach(pl => {
                    if (pl.order === order) {
                        orderPresent = true
                    }
                })
                if (!orderPresent) {
                    orderResolved = order
                } else {
                    order++
                }
            }
            player.order = order
            gameStatus[player.room].push(player)
        }
    } else {
        // first player in the room becomes admin
        player.admin = true
        player.order = 1
        gameStatus[player.room] = [player]
        io.to(player.id).emit('youareadmin');
    }
}

http.listen(3000, function(){
    console.log('listening on *:3000 2');
});