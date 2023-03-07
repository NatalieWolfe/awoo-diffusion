FROM node:18

ENV SHITBOT_HOST localhost:6969
ENV SD_HOST localhost:7860

RUN adduser sidecar
USER sidecar
WORKDIR /opt/sidecar

COPY --chown=sidecar:sidecar sidecar/package.json .
COPY --chown=sidecar:sidecar sidecar/package-lock.json .
RUN ls -la . && npm install

COPY --chown=sidecar:sidecar sidecar/tsconfig.json .
COPY --chown=sidecar:sidecar sidecar/src ./src
RUN npm run compile

CMD ["npm", "start"]
