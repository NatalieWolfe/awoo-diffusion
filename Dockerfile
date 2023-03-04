FROM python:3:10

WORKDIR /opt/awoo/diffusion

RUN wget -qO- https://raw.githubusercontent.com/AUTOMATIC1111/stable-diffusion-webui/master/webui.sh | bash

CMD ["webui.sh"]
