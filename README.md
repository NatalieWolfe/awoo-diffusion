Awoo Diffusion
==============

## Requirements
The Stable Diffusion WebUI container requires GPU access. To grant that in a
container you must install `nvidia-container-runtime`.

```sh
curl -s -L https://nvidia.github.io/nvidia-container-runtime/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-container-runtime/$(. /etc/os-release;echo $ID$VERSION_ID)/nvidia-container-runtime.list | sudo tee /etc/apt/sources.list.d/nvidia-container-runtime.list
sudo apt-get update
sudo apt-get install nvidia-container-runtime
```

Then reboot the Docker service.

## Running just SD Web UI in a container (standalone)

When running this container as its own unit, build and execute it with:

```sh
docker build --target sd_standalone -t sd_web_ui -f sd-web-ui.dockerfile .
docker run --gpus all -P sd_web_ui
```

This will download all the large files in the Docker image.

## Running with host storage

The compose configuration for `sd_web_ui` mounts the path `/var/sd_web_ui` to
the container and configures the service to fetch the large files from there.

You will need to manually create the directores `models/Stable-diffusion`,
`embeddings`, and `outputs` in that directory. Then download the Stable
Diffusion checkpoint into the `models/Stable-diffusion` directory.

```sh
wget -qO- https://huggingface.co/CompVis/stable-diffusion-v-1-4-original/resolve/main/sd-v1-4.ckpt > /var/sd_web_ui/models/Stable-diffusion/sd-v1-4.ckpt
```

The container may then be spun up by using `docker compose` to `build` and `up`
the `sd_web_ui` service. The container will expose port `7860` on the host.

```sh
sudo docker compose build sd_web_ui && sudo docker compose up sd_web_ui
```
