import {Server} from 'socket.io';

const io = new Server();

io.of('/awoo').on('connection', (socket) => {
  const int = setInterval(() => socket.emit('progress'), 1000);
  socket.on('foo', ({image}) => {
    console.log(image.length);
    clearInterval(int);
  });
  socket.emit('request', {requestId: 'foo', txt2img: {prompt: 'wolf'}});
});
io.listen(6969);
