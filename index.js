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
const maxWinkListeners = 4;
const maxPlayersToWink = 3;

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
            // re-order players based on new order
            gameStatus[orderobj.room].playerList = constructPlayerOrder(gameStatus[orderobj.room].playerList, false)
            sendPlayerList(orderobj.room)
        } else {
            io.to(socket.id).emit('adminmsg', 'Please close this tab and use another browser tab from which you are also logged in to this room!')
        }
    })

    socket.on('shuffleorder', room => {
        // verify that user is admin
        let curUser = gameStatus[room].playerList.find(p => (p.id === socket.id))
        if (curUser && curUser.admin && gameStatus[room].playerList.length) {
            gameStatus[room].playerList = constructPlayerOrder(gameStatus[room].playerList, true)
            console.log('actualPlayerList')
            console.log(gameStatus[room].playerList)
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
            io.to(socket.id).emit('yourplayer', sendObj)
            // resolve any outstanding winks
            if (sendObj && sendObj.winkTo) {
                sendObj.winkTo.forEach(playerOrder => {
                    let listenTarget = gameStatus[requestobj.room].playerList.find(p => (p.order === playerOrder))
                    resolveWinks(sendObj, listenTarget)
                })
            }
            if (sendObj && sendObj.listenTo) {
                sendObj.listenTo.forEach(playerOrder => {
                    let winkSource = gameStatus[requestobj.room].playerList.find(p => (p.order === playerOrder))
                    resolveWinks(winkSource, sendObj)
                })
            }
        }
    })

    socket.on('winkTo', requestobj => {
        if (gameStatus[requestobj.room]) {
            let curUser = gameStatus[requestobj.room].playerList.find(p => (p.id === socket.id))
            if (curUser && !curUser.winkTo) {
                curUser.winkTo = [requestobj.winkTarget]
                let winkTargetPlayer = gameStatus[requestobj.room].playerList.find(p => (p.order === requestobj.winkTarget))
                if (!resolveWinks(curUser, winkTargetPlayer)) {
                    io.to(socket.id).emit('adminmsg', 'You winked to player ' + requestobj.winkTarget)
                } else {
                    io.to(socket.id).emit('adminmsg', 'Player ' + requestobj.winkTarget + ' saw you winking!')
                    io.to(winkTargetPlayer.id).emit('adminmsg', 'Player ' + curUser.order + ' winked to you!')
                }
            } else if (curUser && curUser.winkTo && curUser.winkTo.length < maxPlayersToWink) {
                curUser.winkTo.push(requestobj.winkTarget)
                let winkTargetPlayer = gameStatus[requestobj.room].playerList.find(p => (p.order === requestobj.winkTarget))
                if (!resolveWinks(curUser, winkTargetPlayer)) {
                    io.to(socket.id).emit('adminmsg', 'You winked to player ' + requestobj.winkTarget)
                } else {
                    io.to(socket.id).emit('adminmsg', 'Player ' + requestobj.winkTarget + ' saw you winking!')
                    io.to(winkTargetPlayer.id).emit('adminmsg', 'Player ' + curUser.order + ' winked to you!')
                }
            } else if (curUser) {
                io.to(socket.id).emit('adminmsg', 'You can wink no more than ' + maxPlayersToWink + ' times per game!')
            }
        }
    })

    socket.on('listenTo', requestobj => {
        if (gameStatus[requestobj.room]) {
            let curUser = gameStatus[requestobj.room].playerList.find(p => (p.id === socket.id))
            if (curUser && !curUser.listenTo) {
                curUser.listenTo = [requestobj.listenTarget]
                let listenPlayer = gameStatus[requestobj.room].playerList.find(p => (p.order === requestobj.listenTarget))
                if (!resolveWinks(listenPlayer, curUser)) {
                    io.to(socket.id).emit('adminmsg', 'You are now listening to player ' + requestobj.listenTarget)
                } else {
                    io.to(socket.id).emit('adminmsg', 'Player ' + requestobj.listenTarget + ' winked to you!')
                    io.to(listenPlayer.id).emit('adminmsg', 'Player ' + curUser.order + ' saw you winking!')
                }
            } else if (curUser && curUser.listenTo.length < maxWinkListeners) {
                curUser.listenTo.push(requestobj.listenTarget)
                let listenPlayer = gameStatus[requestobj.room].playerList.find(p => (p.order === requestobj.listenTarget))
                if (!resolveWinks(listenPlayer, curUser)) {
                    io.to(socket.id).emit('adminmsg', 'You are now listening to player ' + requestobj.listenTarget)
                } else {
                    io.to(socket.id).emit('adminmsg', 'Player ' + requestobj.listenTarget + ' winked to you!')
                    io.to(listenPlayer.id).emit('adminmsg', 'Player ' + curUser.order + ' saw you winking!')
                }
            } else if (curUser) {
                io.to(socket.id).emit('adminmsg', 'You can listen to max ' + maxWinkListeners + ' players per game!')
            }
        }
    })
    
    socket.on('transferGameMaster', function (requestobj) {
        // verify that user is admin
        let curUser = gameStatus[requestobj.room].playerList.find(p => (p.id === socket.id))
        if (curUser && curUser.admin) {
            let newMaster = gameStatus[requestobj.room].playerList.find(p => (p.name === requestobj.name))
            if (newMaster) {
                newMaster.admin = true
                curUser.admin = false
                io.to(newMaster.id).emit('youareadmin')
                io.to(requestobj.room).emit('adminmsg', 'Player ' + newMaster.name + ' has become Game Master!')
                saveGameStatusOnRedis()
            }
        } else {
            io.to(socket.id).emit('adminmsg', 'Please close this tab and use another browser tab from which you are also logged in to this room!')
        }
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
            for (let i=0, j=0; i < cardList.length && j < gameStatus[shuffleObj.room].playerList.length; i++, j++) {
                while (j < gameStatus[shuffleObj.room].playerList.length && (gameStatus[shuffleObj.room].playerList[j].order === 'Guest'
                || gameStatus[shuffleObj.room].playerList[j].order === 'Host')) {
                    j++
                }
                gameStatus[shuffleObj.room].playerList[j].card = cardList[i]
                gameStatus[shuffleObj.room].playerList[j].winkTo = []
                gameStatus[shuffleObj.room].playerList[j].listenTo = []
                io.to(gameStatus[shuffleObj.room].playerList[j].id).emit('cardassigned', cardList[i])
                io.to(shuffleObj.room).emit('gamenumber', gameStatus[shuffleObj.room].cardShuffleSequence)
            }
            saveGameStatusOnRedis()
            console.log(gameStatus[shuffleObj.room])
        } else {
            io.to(socket.id).emit('adminmsg', 'Please close this tab and use another browser tab from which you are also logged in to this room!')
        }
    })
})

// constructs player order, and if shuffle is true does the shuffle
function constructPlayerOrder (playerList, shuffleOrder) {
    let playerListForShuffle = []
    let host = undefined
    let guests = []

    for (let i=0; i < playerList.length; i++) {
        if (playerList[i].order === "Host" && !host) {
            host = playerList[i]
        } else if (playerList[i].order === "Host" && host) {
            // can't have more than 1 host so make them guest
            playerList[i].order = "Guest"
            guests.push(playerList[i])
        } else if (playerList[i].order === "Guest") {
            guests.push(playerList[i])
        } else {
            playerListForShuffle.push(playerList[i])
        }
    }

    console.log(playerListForShuffle)

    if (shuffleOrder) {
        // construct order list by the number of players
        let orderList = [...Array(playerListForShuffle.length).keys()]
        orderList.shift()
        orderList.push(playerListForShuffle.length)
        // shuffle order list
        shuffle(orderList)
        console.log('shuffled order list, new list = ' + orderList)
        // assign new orders to players
        if (orderList && orderList.length) {
            for (let i=0; i < orderList.length; i++) {
                playerListForShuffle[i].order = orderList[i]
            }
        }
    }
    
    // sort playerList by order
    playerListForShuffle = playerListForShuffle.sort((a,b) => {
        return a.order - b.order
    })
    // update actual game status
    let actualPlayerList = []
    if (host) {
        actualPlayerList.push(host)
    }
    console.log(playerListForShuffle)
    actualPlayerList = actualPlayerList.concat(playerListForShuffle)
    actualPlayerList = actualPlayerList.concat(guests)
    return actualPlayerList
}

function resolveWinks (whoWinked, winkTarget) {
    let linked = false
    if (whoWinked && winkTarget && whoWinked.winkTo && whoWinked.winkTo.includes(winkTarget.order) && winkTarget.listenTo && winkTarget.listenTo.includes(whoWinked.order)) {
        io.to(whoWinked.id).emit('winksuccess', winkTarget.order)
        io.to(winkTarget.id).emit('listensuccess', whoWinked.order)
        linked = true
    }
    return linked
}

function sendPlayerList (room, id) {
    let target = id ? id : room
    let playerList = []
    if (gameStatus[room]) {
        gameStatus[room].playerList.forEach(p => {
            let pObj = {
                admin: p.admin,
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