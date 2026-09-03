FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

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
    xvfb \
    x11vnc \
    novnc \
    websockify \
    dbus-x11 \
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

# Pi is PINNED, not floated. Pass the pin in from package.json's jkai.piVersion:
#
#   docker build -t jkai-sandbox:latest \
#     --build-arg PI_VERSION="$(node -p "require('./package.json').jkai.piVersion")" \
#     --build-arg PI_PACKAGE="$(node -p "require('./package.json').jkai.piPackage")" \
#     docker/jkai-sandbox
#
# The unpinned `npm install -g @mariozechner/pi-coding-agent` this replaces is
# how the running container ended up on 0.69.0 while the build host ran 0.72.1 —
# two pi installs, months apart, neither recorded anywhere. The builder's
# assertPiVersion() refuses to run against a mismatch, so a stale image now
# announces itself instead of silently changing how builds behave.
ARG PI_VERSION
# The package NAME is a build arg for the same reason the version is: pi was
# renamed out from under this line once already.
ARG PI_PACKAGE
RUN set -eu; \
    test -n "$PI_VERSION" || { echo "ERROR: --build-arg PI_VERSION is required (see package.json jkai.piVersion)"; exit 1; }; \
    test -n "$PI_PACKAGE" || { echo "ERROR: --build-arg PI_PACKAGE is required (see package.json jkai.piPackage)"; exit 1; }; \
    npm install -g typescript tsx "${PI_PACKAGE}@${PI_VERSION}"; \
    installed="$(pi --version 2>&1 | head -1)"; \
    test "$installed" = "$PI_VERSION" || { echo "ERROR: installed pi '$installed' != requested $PI_VERSION"; exit 1; }

RUN useradd -m -s /bin/bash jkai
WORKDIR /home/jkai/workspace
RUN chown -R jkai:jkai /home/jkai

USER jkai

CMD ["sleep", "infinity"]
