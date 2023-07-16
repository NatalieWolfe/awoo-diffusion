import { promises as fs } from 'node:fs';
import io from 'socket.io-client';
import dayjs from 'dayjs';

import * as sd from './sd-web-ui.mjs';
import { AxiosResponse } from 'axios';

interface Request {
  requestId: string;
}

interface Txt2ImgRequest extends Request {
  txt2img: sd.Txt2ImgRequest;
}

interface UpdateEmbeddingRequest extends Request {
  embeddingName: string;
  image: string;
  ext: string;
}

const socket = io(`http://${process.env.SHITBOT_HOST}/awoo`);

socket.on('request', async (req: Txt2ImgRequest) => {
  console.log(req);
  const { data: { images } } = await sd.txt2img(req.txt2img);
  socket.emit(req.requestId, { requestId: req.requestId, image: images[0] });
});

socket.on('progress', async () => {
  const { data: response } = await sd.progress();
  delete response.current_image;
  socket.emit('progress', response);
});

socket.on('updateEmbedding', async (req: UpdateEmbeddingRequest) => {
  console.log('Updating', req.embeddingName);
  const embeddingPath = `${process.env.SD_ROOT}/training/${req.embeddingName}`;
  if (!await checkAccess(embeddingPath)) {
    await makeEmbeddingDirectories(embeddingPath);
    logResponse(await sd.createEmbedding({
      name: req.embeddingName,
      num_vectors_per_token: 20,
      overwrite_old: true
    }));
  }
  const name = dayjs().format('YYYY-MM-DD HH-mm-ss');
  await fs.writeFile(
    `${embeddingPath}/sources/${name}${req.ext}`,
    Buffer.from(req.image, 'base64')
  );
  logResponse(await sd.preprocess({
    process_src: `${embeddingPath}/sources`,
    process_dst: `${embeddingPath}/prepared`,
    preprocess_txt_action: 'append',
    process_width: 512,
    process_height: 512,
    process_flip: true,
    process_split: true,
    process_caption: true,
    process_caption_deepbooru: true,
  }));
  logResponse(await sd.trainEmbedding({
    embedding_name: req.embeddingName,
    learn_rate: '0.005:100 0.001:1000, 0.00001',
    batch_size: 1,
    gradient_step: 50,
    data_root: `${embeddingPath}/prepared`,
    log_directory: `textual_inversion`,
    training_height: 512,
    training_width: 512,
    steps: 10000,
    create_image_every: 0,
    save_embedding_every: 0,
    template_filename: 'subject_filewords.txt',
    shuffle_tags: true
  }));
  socket.emit(req.requestId);
});

async function checkAccess(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch (e) {
    return false;
  }
}

async function makeEmbeddingDirectories(path: string) {
  const opts = {recursive: true, mode: '777'};
  await fs.mkdir(`${path}/sources`, opts);
  await fs.mkdir(`${path}/prepared`, opts);
  await fs.mkdir(`${path}/logs`, opts);
  await fs.chmod(path, 0o777);
  await fs.chmod(`${path}/sources`, 0o777);
  await fs.chmod(`${path}/prepared`, 0o777);
  await fs.chmod(`${path}/logs`, 0o777);
}

function logResponse(res: AxiosResponse<sd.InfoResponse>) {
  const {status, config: {url}, data} = res;
  console.log(url, status, data);
}
