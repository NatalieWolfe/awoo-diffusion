# This docker file defines 3 images:
#   - sd_web_base
#   - sd_host_storage
#   - sd_standalone
#
# See README.md for instructions on running this image as a standalone.
FROM python:3.10 AS sd_web_base

ENV PROGRAM_ROOT=/opt/awoo/diffusion
ENV REPO_ROOT=${PROGRAM_ROOT}/stable-diffusion-webui

RUN apt-get update
RUN apt-get install -y libgl1 libglib2.0-0

RUN adduser awoo
USER awoo

# Get the Web UI
WORKDIR ${PROGRAM_ROOT}
RUN git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui

# Get the dependency repositories.
WORKDIR ${PROGRAM_ROOT}/stable-diffusion-webui/repositories
RUN git clone https://github.com/Stability-AI/stablediffusion.git stable-diffusion-stability-ai
RUN git clone https://github.com/CompVis/taming-transformers.git taming-transformers
RUN git clone https://github.com/crowsonkb/k-diffusion.git k-diffusion
RUN git clone https://github.com/sczhou/CodeFormer.git CodeFormer
RUN git clone https://github.com/salesforce/BLIP.git BLIP

# Install python dependencies.
WORKDIR ${REPO_ROOT}
RUN pip install --upgrade pip
RUN pip install -r requirements_versions.txt

# Execute.
EXPOSE 7860
CMD ["python3", "launch.py", "--listen", "--api"]

################################################################################
# This part of the image is used as a compose unit with host machine storage for
# images and models.
FROM sd_web_base AS sd_host_storage

ENV PROGRAM_ROOT=/opt/awoo/diffusion
ENV REPO_ROOT=${PROGRAM_ROOT}/stable-diffusion-webui
ENV DATA_ROOT=/var/sd_web_ui

RUN rm -rf ${REPO_ROOT}/models/Stable-diffusion && \
    rm -rf ${REPO_ROOT}/embeddings && \
    rm -rf ${REPO_ROOT}/outputs

RUN ln -s ${DATA_ROOT}/models/Stable-diffusion \
          ${REPO_ROOT}/models/Stable-diffusion && \
    ln -s ${DATA_ROOT}/embeddings ${REPO_ROOT}/embeddings && \
    ln -s ${DATA_ROOT}/outputs ${REPO_ROOT}/outputs

WORKDIR ${REPO_ROOT}

################################################################################
# This part of the image is for running the container on its own.
FROM sd_web_base AS sd_standalone

ENV PROGRAM_ROOT=/opt/awoo/diffusion
ENV REPO_ROOT=${PROGRAM_ROOT}/stable-diffusion-webui

# Get the models.
WORKDIR ${REPO_ROOT}/models
RUN mkdir -p Stable-diffusion
RUN wget -qO- https://huggingface.co/CompVis/stable-diffusion-v-1-4-original/resolve/main/sd-v1-4.ckpt > Stable-diffusion/sd-v1-4.ckpt

WORKDIR ${REPO_ROOT}
