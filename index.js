var app = require('express')();
var http = require('http').createServer(app);
var io  = require('socket.io')(http, { path: '/api'});

app.get('/api', function(req, res){
    res.send('<h1>Hello world</h1>');
});

io.on('connection', function(socket){
    console.log('a user connected');

    socket.on('joinroom', function (data) {
        console.log('join room 1');
        console.log(data);
        socket.join(data);
        io.to(data).emit('joinedroom');
    });
});

http.listen(3000, function(){
    console.log('listening on *:3000');
});