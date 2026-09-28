<script lang="ts">
  import LegalPage from '$lib/components/LegalPage.svelte';
</script>

<svelte:head>
  <title>Privacy — Strange Ramblings</title>
  <meta name="description" content="What strangeramblings.com collects, why, and what it does with it." />
</svelte:head>

<LegalPage title="Privacy" updated="28 September 2026">
  <p>
    Strange Ramblings is my personal website, run by me, John Kelly, in the UK. It isn't a business and
    it doesn't sell anything, least of all you. This page says what the site collects, why, and what I do
    with it, and I've tried to keep it to what the site actually does rather than what a template says it
    might.
  </p>

  <h2>If you're just reading</h2>
  <p>
    You don't need an account to read anything public here. I count visits with Umami, which I host
    myself at analytics.strangeramblings.com — it doesn't set cookies and doesn't know who you are, it
    just tells me which pages get read. Blog posts also note how far down a page a read got, keyed on
    an id that lives in your browser tab and dies with it, with no IP address and no identity attached.
  </p>
  <p>
    Pages reach you through Cloudflare, and the site runs on a server rented from Hetzner in the EU, so
    both see the ordinary technical details any website request carries, like your IP address, for as
    long as their own logs keep them.
  </p>

  <h2>If you leave a comment</h2>
  <p>
    A comment stores the name you type and what you wrote, both public, plus a one-way hash of your IP
    address that I use only to slow down spam — I can't turn it back into the address.
  </p>

  <h2>If you sign in with Google</h2>
  <p>
    Signing in is by invitation only. When you choose "Sign in with Google", Google tells the site your
    name, email address and profile picture, and the site checks the email against the people I've
    invited. If you aren't on that list you're turned away and nothing is kept, apart from a line in the
    server log saying the address tried and was refused. If you are, the site sets a session cookie so
    you stay signed in, and that's the only cookie it uses.
  </p>

  <h2>If you use the iPhone app</h2>
  <p>
    SR Companion is the site's iPhone app, and like the site it's invitation only. You can sign in with
    Apple or Google, which tells me your name and email address (or the private relay address Apple
    makes if you ask it to hide yours), and I look at every request by hand before the account opens. If
    I turn a request down, or you withdraw it, the request is all that's kept.
  </p>
  <p>
    If you choose to share your location, the app sends where your phone is to my server so the people
    in the family I've approved can see where you are, how charged your battery is and where you've been
    today. It keeps doing that in the background, and after you leave a place you've picked it records
    the journey more closely until you arrive — you can pause sharing whenever you like from Settings.
    The phone's motion sensor is only read on the phone, to switch the GPS off while you're sitting still,
    and none of that leaves it.
  </p>
  <p>
    Apple Health data only goes up for the categories you pick, and it lands on your own health page,
    which nobody else in the family can open. The one exception is your step total for the day, which
    sits on the family steps leaderboard for everyone on it to see. The app reads from Apple Health and
    never writes to it.
  </p>
  <p>
    Family tasks — what the job is, who it's for, who did it and any reward attached — are seen by the
    family, and a reward is just a note of what's owed, the app doesn't handle money. If you chat to jkai
    from the app, your messages, photos and voice notes are stored with your account and sent to the AI
    model providers the site uses to answer them, the same as on the site; voice notes are turned into
    text on your phone first, and the recording is kept alongside so you can play it back. To send you
    notifications your phone gets a push token from Apple, which I keep against your account.
  </p>
  <p>
    It all sits on the same servers in the EU as the rest of the site. None of it is sold, used for
    advertising or shared with anyone outside the family, and because it's my server I could technically
    read it, which I don't. You can delete your account from the app, in Settings, and that removes your
    account, your phones, the location history and health data your phone sent, your chats and anything
    you saved on the site, straight away. Tasks you wrote for someone else stay on the family's list
    with your name taken off, and if you share your location through Life360 as well, the family's
    record of that isn't part of the app and stays until you ask me. Backups roll over as described below.
  </p>

  <h2>If you connect a Gmail account</h2>
  <p>
    Only I and people I've invited can connect a mailbox, and only from a signed-in session. My own
    mailbox is connected with permission to read, label and send mail, because my automations do those
    things on my behalf. An invited family member's mailbox is connected read-only, it can only be their
    own address, and what's read from it lands in their own private space on the site that nobody else
    can see.
  </p>
  <p>
    A connected mailbox is read at least once a night (I can also run it by hand), and most of it is left
    alone. To know who you write to, the site reads the To and Cc lines of your sent mail from the past
    year and keeps only a one-way hash of each address. A thread is only taken in if you've starred it or
    given it the label "intel", or if it's correspondence with a person (a thread you wrote in, someone
    you write to, or anyone else who isn't a newsletter or an automated sender) and an automatic check
    agrees it's worth remembering rather than a receipt or a pleasantry. That check sends the thread's
    subject, who was on it and its first 1,500 or so characters to an AI model, whichever way it decides.
    Threads
    that are taken in become notes and facts in your own private knowledge graph, and to do that their
    full text is sent to the AI model providers the site uses (currently OpenAI, OpenRouter and Z.ai)
    under their API terms. Every other recent thread is kept only as its subject, who was on it and the
    date, and that is deleted after 14 days. I don't use any of it to
    train models, I don't sell it, and I don't use it for advertising. The access tokens Google issues
    are stored encrypted.
  </p>
  <p>
    The site's use and transfer of information received from Google APIs adheres to the
    <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Google API Services User Data Policy</a>,
    including the Limited Use requirements.
  </p>
  <p>
    You can take the access away whenever you like, from the site or from your
    <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Google account's third-party access page</a>.
    When I disconnect a mailbox on the site, what was taken from it is deleted: the notes made from its
    mail, the graph facts drawn from them, its search index and any attachments that were saved. If you
    take the access away from Google's side instead, or you'd just like it gone, ask me and I'll delete
    what was read from your mailbox.
  </p>

  <h2>Keeping and deleting</h2>
  <p>
    I keep things for as long as the feature they belong to needs them. The site is backed up, encrypted,
    so something deleted can live on in a backup for a while before the backups roll over. If you want
    something you gave the site removed, ask me and I'll do it.
  </p>

  <h2>Your rights</h2>
  <p>
    Under UK data protection law you can ask what I hold about you, have it corrected or deleted, or
    object to how it's used. You can also complain to the
    <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener">Information Commissioner's Office</a>,
    though I'd rather you told me first.
  </p>

  <h2>Getting hold of me</h2>
  <p>
    Email me at <a href="mailto:john@strangeramblings.com">john@strangeramblings.com</a>. If this page
    changes, the date at the top changes with it.
  </p>
</LegalPage>
