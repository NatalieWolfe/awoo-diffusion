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
