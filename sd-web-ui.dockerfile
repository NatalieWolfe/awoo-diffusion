FROM python:3.10

RUN apt-get update
RUN apt-get install -y libgl1 libglib2.0-0

RUN adduser awoo

# Get the Web UI
USER awoo
WORKDIR /opt/awoo/diffusion
RUN git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui

# Get the dependency repositories.
WORKDIR /opt/awoo/diffusion/stable-diffusion-webui/repositories
RUN git clone https://github.com/Stability-AI/stablediffusion.git stable-diffusion-stability-ai
RUN git clone https://github.com/CompVis/taming-transformers.git taming-transformers
RUN git clone https://github.com/crowsonkb/k-diffusion.git k-diffusion
RUN git clone https://github.com/sczhou/CodeFormer.git CodeFormer
RUN git clone https://github.com/salesforce/BLIP.git BLIP

# Get the models.
WORKDIR /opt/awoo/diffusion/stable-diffusion-webui/models
RUN mkdir -p Stable-diffusion
RUN wget -qO- https://huggingface.co/CompVis/stable-diffusion-v-1-4-original/resolve/main/sd-v1-4.ckpt > Stable-diffusion/sd-v1-4.ckpt


# Install python dependencies.
WORKDIR /opt/awoo/diffusion/stable-diffusion-webui
RUN pip install --upgrade pip
RUN pip install -r requirements_versions.txt

# Execute.
EXPOSE 7860
CMD ["python3", "/opt/awoo/diffusion/stable-diffusion-webui/launch.py", "--listen", "--api"]
