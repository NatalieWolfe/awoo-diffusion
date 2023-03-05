import {Server} from 'socket.io';

const io = new Server();

io.of('/awoo').on('connection', (socket) => {
  socket.on('txt2img', ({image}) => console.log(image));
  socket.emit('request', {requestId: 'foo', txt2img: {prompt: 'wolf'}});
});
io.listen(6969);
