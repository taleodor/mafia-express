const app = require('express')();
const http = require('http').createServer(app);
const io  = require('socket.io')(http, { path: '/api'});
const redis = require('redis');
const redisClient = redis.createClient( 
    {
        host: process.env.REDIS_HOST ? process.env.REDIS_HOST : '127.0.0.1',
        port: 6379
    }
);

// add timestamps in front of log messages
require('console-stamp')(console, 'yyyy-mm-dd HH:MM:ss.l');

redisClient.on("error", function(error) {
    console.error(error);
});

var gameStatus = {}
redisClient.get('mafiaGameState', (err, reply) => {
    if (!err && reply) {
        gameStatus = JSON.parse(reply)
    }
})

app.get('/api', function(req, res){
    res.send('<h1>Hello world</h1>');
});

io.on('connection', function(socket){
    console.log('a user connected');

    socket.on('joinroom', function (data) {
        console.log(data.name + ', uuid = ' + data.uuid + ' joined room ' + data.room)
        socket.join(data.room)
        data.id = socket.id
        updateGameStatus(data, socket)
        sendPlayerList(data.room)
        
        // console.log(gameStatus)
    });

    socket.on('kickplayer', kickobj => {
        // verify that user is admin
        let curUser = gameStatus[kickobj.room].playerList.find(p => (p.id === socket.id))
        if (curUser && curUser.admin) {
            gameStatus[kickobj.room].playerList = gameStatus[kickobj.room].playerList.filter(p => (p.name !== kickobj.name))
            saveGameStatusOnRedis()
            sendPlayerList(kickobj.room)
            io.to(kickobj.room).emit('adminmsg', 'player ' + kickobj.name + ' has been removed by Game Master!')
        } else {
            io.to(socket.id).emit('adminmsg', 'Please close this tab and use another browser tab from which you are also logged in to this room!')
        }
    })

    socket.on('requestroom', function (roomobj) {
        // if this uuid is in the list, update id with current player
        if (gameStatus[roomobj.room]) {
            let curUser = gameStatus[roomobj.room].playerList.find(p => (p.uuid === roomobj.uuid))
            if (curUser) {
                socket.join(roomobj.room)
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
        let curUser = gameStatus[orderobj.room].playerList.find(p => (p.id === socket.id))
        if (curUser && curUser.admin) {
            let updUser = gameStatus[orderobj.room].playerList.find(p => (p.name === orderobj.player))
            updUser.order = orderobj.order
            let updObj = {
                name: updUser.name,
                order: updUser.order
            }
            io.to(orderobj.room).emit('orderchanged', updObj)
            sendPlayerList(orderobj.room)
        } else {
            io.to(socket.id).emit('adminmsg', 'Please close this tab and use another browser tab from which you are also logged in to this room!')
        }
    })

    socket.on('shuffleorder', room => {
        // verify that user is admin
        let curUser = gameStatus[room].playerList.find(p => (p.id === socket.id))
        if (curUser && curUser.admin) {
            let orderList = []
            // construct order list
            gameStatus[room].playerList.forEach(player => {
                orderList.push(player.order)
            })
            // shuffle order list
            shuffle(orderList)
            console.log('shuffled order list, new list = ' + orderList)
            
            // assign new orders to players
            for (let i=0; i < orderList.length; i++) {
                gameStatus[room].playerList[i].order = orderList[i]
            }
            saveGameStatusOnRedis()
            io.to(room).emit('ordershuffled')
            sendPlayerList(room)
            console.log(gameStatus[room])
        } else {
            io.to(socket.id).emit('adminmsg', 'Please close this tab and use another browser tab from which you are also logged in to this room!')
        }
    })

    socket.on('requestmyplayer', requestobj => {
        let sendObj = {}
        if (gameStatus[requestobj.room]) {
            sendObj = gameStatus[requestobj.room].playerList.find(p => (p.uuid === requestobj.uuid))
            if (sendObj) {
                sendObj.game = gameStatus[requestobj.room].cardShuffleSequence
            }
        }
        io.to(socket.id).emit('yourplayer', sendObj)
    })

    socket.on('shufflecards', function (shuffleObj) {
        // verify that user is admin
        let curUser = gameStatus[shuffleObj.room].playerList.find(p => (p.id === socket.id))
        if (curUser && curUser.admin) {
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

            // increment shffle sequence
            gameStatus[shuffleObj.room].cardShuffleSequence += 1

            // assign cards to players
            for (let i=0; i < cardList.length; i++) {
                gameStatus[shuffleObj.room].playerList[i].card = cardList[i]
                io.to(gameStatus[shuffleObj.room].playerList[i].id).emit('cardassigned', cardList[i])
            }
            saveGameStatusOnRedis()
            console.log(gameStatus[shuffleObj.room])
        } else {
            io.to(socket.id).emit('adminmsg', 'Please close this tab and use another browser tab from which you are also logged in to this room!')
        }
    })
});

function sendPlayerList (room, id) {
    let target = id ? id : room
    let playerList = []
    if (gameStatus[room]) {
        gameStatus[room].playerList.forEach(p => {
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

function saveGameStatusOnRedis () {
    redisClient.set('mafiaGameState', JSON.stringify(gameStatus))
}

function updateGameStatus (player, socket) {
    if (gameStatus[player.room]) {
        let proceed = true
        let existingPlayer = gameStatus[player.room].playerList.find(p => (p.name === player.name))
        // if name matches but id doesn't match, infom player that id is taken
        // if id matches, and player name matches, don't do anything
        // if id matches but player name is different update name
        if (existingPlayer && existingPlayer.id !== player.id) {
            io.to(player.id).emit('nametaken');
            proceed = false
        }

        // if id matches, simply rename the player
        let sameIdPlayer = gameStatus[player.room].playerList.find(p => (p.id === player.id))
        if (proceed && sameIdPlayer && sameIdPlayer.id === player.id && sameIdPlayer.name !== player.name) {
            let oldPlayerName = sameIdPlayer.name
            sameIdPlayer.name = player.name
            proceed = false
            io.to(player.room).emit('adminmsg', oldPlayerName + ' renamed themselves to ' + player.name)
        }
        // only append if this name is not in the room yet
        if (proceed && !gameStatus[player.room].playerList.find(p => (p.name === player.name))) {
            // compute player order - next available
            let order = 1
            let orderResolved = -1
            for (let i=0; i < gameStatus[player.room].playerList.length + 1 && orderResolved < 0; i++) {
                let orderPresent = false
                gameStatus[player.room].playerList.forEach(pl => {
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
            gameStatus[player.room].playerList.push(player)
            socket.to(player.room).emit('joinedroom', player.name)
        }
    } else {
        // first player in the room becomes admin
        player.admin = true
        player.order = 1
        gameStatus[player.room] = {
            cardShuffleSequence: 0,
            playerList: [player]
        }
        io.to(player.id).emit('youareadmin');
    }
    saveGameStatusOnRedis()
}

http.listen(3000, function(){
    console.log('listening on *:3000 2');
});