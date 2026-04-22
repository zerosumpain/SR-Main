FROM python:3.12-slim

# Switch Debian repos to HTTPS — the build network blocks outbound port 80.
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
 && sed -i 's|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list.d/debian.sources

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    jq \
    vim-tiny \
    iproute2 \
    procps \
    build-essential \
    ca-certificates \
    # Playwright browser deps
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libxfixes3 \
    fonts-liberation \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    requests \
    pandas \
    numpy \
    matplotlib \
    beautifulsoup4 \
    httpx \
    pyyaml \
    playwright \
    playwright-stealth \
    tenacity \
    lxml

# Install Chromium to a shared path so both root and non-root users can use it.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN playwright install chromium \
 && chmod -R a+rX /opt/playwright-browsers

RUN npm install -g typescript tsx @mariozechner/pi-coding-agent

RUN useradd -m -s /bin/bash jkai
WORKDIR /home/jkai/workspace
RUN chown -R jkai:jkai /home/jkai

USER jkai

CMD ["sleep", "infinity"]
