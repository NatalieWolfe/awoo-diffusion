import axios, { AxiosResponse } from 'axios';

const SD_HOST = 'localhost:32777';

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

export interface Txt2ImgResponse {
  images: string[];
  parameters: Txt2ImgRequest;
  info: string;
}

export function txt2img(req: Txt2ImgRequest): Promise<AxiosResponse<Txt2ImgResponse>> {
  return axios.post(`http://${SD_HOST}/sdapi/v1/txt2img`, req);
}
