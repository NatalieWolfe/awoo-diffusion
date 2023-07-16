import axios, { AxiosResponse } from 'axios';

const SD_HOST = process.env.SD_HOST || 'localhost:7860';

// TODO: Image dimensions can be any multiple of 8.
type ImageDimension = 256 | 512 | 1024;
type SamplingMethod =
  'Euler a' |
  'Euler' |
  'LMS' |
  'Heun' |
  'DPM2' |
  'DPM2 a' |
  'DPM++ 2S a' |
  'DPM++ 2M' |
  'DPM++ SDE' |
  'DPM fast' |
  'DPM adaptive' |
  'LMS Karras' |
  'DPM2 Karras' |
  'DPM2 a Karras' |
  'DPM++ 2S a Karras' |
  'DPM++ 2M Karras' |
  'DPM++ SDE Karras' |
  'DDIM' |
  'PLMS';
type PreprocessTextAction = 'copy' | 'append' | 'prepend';
type MultiCropObjective = 'Maximize area';
type LatentSamplingMethod = 'deterministic' | 'once' | 'random';
type ClipGradMode = 'value' | 'norm';

export interface Txt2ImgRequest {
  prompt: string;
  enable_hr?: boolean;
  denoising_strength?: number;
  firstphase_width?: number;
  firstphase_height?: number;
  hr_scale?: number;
  hr_upscaler?: string;
  hr_second_pass_steps?: number;
  hr_resize_x?: number;
  hr_resize_y?: number;
  styles?: string[];
  seed?: number;
  subseed?: number;
  subseed_strength?: number;
  seed_resize_from_h?: number;
  seed_resize_from_w?: number;
  sampler_name?: string;
  batch_size?: number;
  n_iter?: number;
  steps?: number;
  cfg_scale?: number;
  width?: ImageDimension;
  height?: ImageDimension;
  restore_faces?: boolean;
  tiling?: boolean;
  negative_prompt?: string;
  eta?: number;
  s_churn?: number;
  s_tmax?: number;
  s_tmin?: number;
  s_noise?: number;
  override_settings?: object;
  override_settings_restore_afterwards?: boolean;
  script_args?: string[];
  sampler_index?: SamplingMethod;
  script_name?: string;
}

interface ImageResponse {
  images: string[];
  parameters: Txt2ImgRequest;
  info: string;
}

export interface Img2ImgRequest {
  prompt: string;
  init_images: string[];
  mask?: string;
  resize_mode?: number;
  denoising_strength?: number;
  image_cfg_scale?: number;
  mask_blur?: 4,
  inpainting_fill?: 0,
  inpaint_full_res?: boolean;
  inpaint_full_res_padding?: number;
  inpainting_mask_invert?: number;
  initial_noise_multiplier?: number;
  styles?: string[];
  seed?: number;
  subseed?: number;
  subseed_strength?: number;
  seed_resize_from_h?: number;
  seed_resize_from_w?: number;
  sampler_name?: string;
  batch_size?: number;
  n_iter?: number;
  steps?: number;
  cfg_scale?: number;
  width?: ImageDimension;
  height?: ImageDimension;
  restore_faces?: boolean;
  tiling?: boolean;
  negative_prompt?: string;
  eta?: number;
  s_churn?: number;
  s_tmax?: number;
  s_tmin?: number;
  s_noise?: number;
  override_settings?: object;
  override_settings_restore_afterwards?: boolean;
  script_args?: string[];
  sampler_index?: SamplingMethod;
  include_init_images?: boolean;
  script_name?: string;
}

interface ProgressResponse {
  progress: number;
  eta_relative: number;
  state: object;
  current_image: string;
  textinfo: string;
}

interface CreateEmbeddingRequest {
  name: string;
  num_vectors_per_token: number;
  overwrite_old: boolean;
  init_text?: string;
}

export interface InfoResponse {
  info: string;
}

interface PreprocessRequest {
  id_task?: any;
  process_src: string;
  process_dst: string;
  process_width: ImageDimension;
  process_height: ImageDimension;
  preprocess_txt_action?: PreprocessTextAction;
  process_flip: boolean;
  process_split: boolean;
  process_caption: boolean;
  process_caption_deepbooru?: boolean;
  split_threshold?: number;
  overlap_ratio?: number;
  process_focal_crop?: boolean;
  process_focal_crop_face_weight?: number;
  process_focal_crop_entropy_weight?: number;
  process_focal_crop_edges_weight?: number;
  process_focal_crop_debug?: boolean;
  process_multicrop?: boolean;
  process_multicrop_mindim?: number;
  process_multicrop_maxdim?: number;
  process_multicrop_minarea?: number;
  process_multicrop_maxarea?: number;
  process_multicrop_objective?: MultiCropObjective;
  process_multicrop_threshold?: number;
}

interface TrainEmbeddingRequest {
  id_task?: any;
  embedding_name: string;
  learn_rate?: string;
  batch_size: number;
  gradient_step: number;
  data_root: string;
  log_directory: string;
  training_width: ImageDimension;
  training_height: ImageDimension;
  steps: number;
  create_image_every: number;
  save_embedding_every: number;
  template_filename: string;
  varsize?: boolean | null;
  clip_grad_mode?: ClipGradMode | null;
  clip_grad_value?: string | null;
  shuffle_tags?: boolean | null;
  tag_drop_out?: number | null;
  latent_sampling_method?: LatentSamplingMethod | null;
  use_weight?: boolean | null;
  save_image_with_stored_embedding?: boolean | null;
  preview_from_txt2img?: boolean | null;
  preview_prompt?: string | null;
  preview_negative_prompt?: string | null;
  preview_steps?: number | null;
  preview_sampler_index?: number | null;
  preview_cfg_scale?: number | null;
  preview_seed?: number | null;
  preview_width?: ImageDimension | null;
  preview_height?: ImageDimension | null;
}

const OPTIONAL_TRAIN_EMBEDDING_FIELDS = new Set([
  'varsize',
  'clip_grad_mode',
  'clip_grad_value',
  'shuffle_tags',
  'tag_drop_out',
  'latent_sampling_method',
  'use_weight',
  'save_image_with_stored_embedding',
  'preview_from_txt2img',
  'preview_prompt',
  'preview_negative_prompt',
  'preview_steps',
  'preview_sampler_index',
  'preview_cfg_scale',
  'preview_seed',
  'preview_width',
  'preview_height'
]);

export function txt2img(
  req: Txt2ImgRequest
): Promise<AxiosResponse<ImageResponse>> {
  return axios.post(`http://${SD_HOST}/sdapi/v1/txt2img`, req);
}

export function progress(): Promise<AxiosResponse<ProgressResponse>> {
  return axios.get(`http://${SD_HOST}/sdapi/v1/progress`);
}

export function createEmbedding(
  req: CreateEmbeddingRequest
): Promise<AxiosResponse<InfoResponse>> {
  return axios.post(`http://${SD_HOST}/sdapi/v1/create/embedding`, req);
}

export function preprocess(
  req: PreprocessRequest
): Promise<AxiosResponse<InfoResponse>> {
  req.id_task = 'gibberish';
  return axios.post(`http://${SD_HOST}/sdapi/v1/preprocess`, req);
}

export function trainEmbedding(
  req: TrainEmbeddingRequest
): Promise<AxiosResponse<InfoResponse>> {
  req.id_task = 'traininggibberish';
  for (const field of OPTIONAL_TRAIN_EMBEDDING_FIELDS) {
    if (!(field in req)) req[field] = null;
  }
  return axios.post(`http://${SD_HOST}/sdapi/v1/train/embedding`, req);
}
