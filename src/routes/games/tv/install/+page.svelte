<svelte:head>
  <title>Install sr. tv</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="inst">
  <p class="inst-brand"><span class="inst-mark">sr.</span> tv</p>
  <h1>Put the games on the TV</h1>
  <p class="inst-lead">
    sr. tv is a small Android TV app that opens the family games full screen. It works on Google TV and Android
    TV sets — a Sony Bravia is what it was tested on. Ten minutes, once.
  </p>

  <ol class="inst-steps">
    <li>
      <h2>Let the TV install apps from outside the Play Store</h2>
      <p>
        <strong>Settings → System → About</strong>, scroll to <strong>Android TV OS build</strong> and press OK on it seven
        times until it says you are a developer.
      </p>
    </li>
    <li>
      <h2>Install Downloader</h2>
      <p>From the Google Play Store on the TV, install <strong>Downloader</strong> (by AFTVnews). Open it once and allow it to reach files.</p>
      <p>
        Then <strong>Settings → Apps → Security &amp; restrictions → Unknown sources</strong> (on some Bravias:
        <strong>Settings → Apps → Special app access → Install unknown apps</strong>) and switch it on for Downloader.
      </p>
    </li>
    <li>
      <h2>Fetch sr. tv</h2>
      <p>In Downloader, type this address and press Go:</p>
      <p class="inst-url">strangeramblings.com/tv/get</p>
      <p>It downloads the app and asks to install it. Choose <strong>Install</strong>, then <strong>Done</strong>; Downloader offers to delete the file — yes.</p>
    </li>
    <li>
      <h2>Open it and link it</h2>
      <p>
        sr. tv is now on the TV's Apps row. The first time it opens it shows four letters: on John's phone go to
        <a href="/admin/access/tvs">strangeramblings.com/admin/access/tvs</a> and type them. That TV stays linked until it
        is unlinked there.
      </p>
    </li>
  </ol>

  <h2 class="inst-alt">Without Downloader</h2>
  <p>
    From a computer on the same network, with the TV's <strong>Developer options → USB debugging</strong> (network
    debugging) switched on: <code>adb connect &lt;tv address&gt;:5555</code> then
    <code>adb install -r sr-tv.apk</code> (the APK is at <a href="/tv/get">/tv/get</a>). On homeserv,
    <code>scripts/install-tv.sh &lt;tv address&gt;</code> does both.
  </p>
  <p>
    No app at all? The TV's own browser works too: open <strong>strangeramblings.com/tv</strong>. The app is nicer — it keeps the
    screen awake, starts from the Apps row and drives with the remote.
  </p>
  <p class="inst-foot">Updates: the app checks when it starts and offers to update itself.</p>
</main>

<style>
  .inst {
    max-width: 44rem;
    margin: 0 auto;
    padding: 2.5rem 1.25rem 4rem;
    font-family: var(--font-body);
    color: var(--text-primary);
    line-height: 1.6;
  }
  .inst-brand {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .inst-mark {
    font-family: var(--font-brand);
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent);
  }
  h1 {
    margin: 0.4rem 0 0.8rem;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2rem;
    line-height: 1.1;
  }
  h2 {
    margin: 0 0 0.3rem;
    font-size: 1.05rem;
  }
  .inst-lead {
    margin: 0 0 1.5rem;
  }
  .inst-steps {
    margin: 0 0 2rem;
    padding-left: 1.4rem;
    display: grid;
    gap: 1.2rem;
  }
  .inst-steps p {
    margin: 0.25rem 0;
  }
  .inst-url {
    font-family: var(--font-mono);
    font-size: 1.15rem;
    padding: 0.6rem 0.8rem;
    border: 2px solid var(--accent);
    border-radius: 2px;
    display: inline-block;
  }
  .inst-alt {
    margin-top: 2rem;
  }
  code {
    font-family: var(--font-code, monospace);
    font-size: 0.9rem;
  }
  a {
    color: var(--accent-ink);
  }
  .inst-foot {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
</style>
