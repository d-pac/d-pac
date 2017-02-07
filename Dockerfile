FROM mhart/alpine-node:6.5.0
MAINTAINER Camille Reynders

ENV DOCKERIZE_VERSION 0.2.0
ENV PATH=/home/dpac/node_modules/.bin:/usr/bin:/usr/local/bin:$PATH

ADD .ssh /root/.ssh
RUN apk add --update openssh
RUN ssh-keyscan -t rsa bitbucket.org >> /root/.ssh/known_hosts

ADD package.json /tmp/package.json

# Solves "Unable to locally verify the issuer's authority." with github.com
# See https://bugs.alpinelinux.org/issues/5376
# Also installs other necessary dependencies
RUN npm config set color false && apk upgrade libssl1.0 --update-cache \
    && apk add --no-cache --virtual .build-deps wget ca-certificates git make gcc g++ python \
    && wget https://github.com/jwilder/dockerize/releases/download/v$DOCKERIZE_VERSION/dockerize-linux-amd64-v$DOCKERIZE_VERSION.tar.gz \
    && tar -C /usr/local/bin -xzvf dockerize-linux-amd64-v$DOCKERIZE_VERSION.tar.gz \
    && cd /tmp && npm install --production && npm cache clean \
    && apk del .build-deps
RUN mkdir -p /home/dpac && mv /tmp/node_modules /home/dpac/
RUN mv /tmp/package.json /home/dpac/package.json

ADD app /home/dpac/app/
WORKDIR /home/dpac
