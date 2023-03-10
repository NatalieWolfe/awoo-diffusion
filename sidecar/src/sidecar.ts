(async () => {
  const { io } = await import('socket.io-client');
  const { progress, txt2img } = await import('./sd-web-ui.mjs');

  interface Request {
    requestId: string;
    txt2img: any;
  }

  interface Response {
    requestId: string;
    image: string;
  }

  const socket = io(`http://${process.env.SHITBOT_HOST}/awoo`);

  socket.on('request', async (req: Request) => {
    console.log(req);
    const { data: { images } } = await txt2img(req.txt2img);
    socket.emit(req.requestId, { requestId: req.requestId, image: images[0] });
  });

  socket.on('progress', async () => {
    const { data: response } = await progress();
    delete response.current_image;
    socket.emit('progress', response);
  });
})();
