<svelte:head>
  <title>Writing — Strange Ramblings</title>
</svelte:head>

<script lang="ts">
  let { data } = $props();

</script>

<section class="min-h-screen p-6 sm:p-8 md:p-12 lg:p-16">
  <!-- Header -->
  <div class="flex justify-between items-start mb-16">
    <a href="/" class="group flex items-baseline no-underline select-none">
      <span
        class="text-[36px] sm:text-[42px] font-thin tracking-[0.15em] leading-none"
        style="color: var(--text-primary); font-family: var(--font-sans);"
      >S</span><span
        class="text-[36px] sm:text-[42px] font-thin tracking-[0.15em] leading-none transition-opacity duration-500"
        style="color: var(--accent); font-family: var(--font-sans); opacity: 0.55;"
      >R</span>
    </a>

    <nav class="flex gap-5 sm:gap-8 pt-2">
      <a href="/" class="nav-link text-[10px] sm:text-[11px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Home
      </a>
    </nav>
  </div>

  <!-- Title -->
  <div class="max-w-lg mx-auto">
    <h1
      class="text-[10px] uppercase tracking-[0.3em] mb-8"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >Writing</h1>

    {#if data.posts.length === 0}
      <p class="text-sm" style="color: var(--text-ghost);">
        Nothing published yet.
      </p>
    {:else}
      <ul class="space-y-6">
        {#each data.posts as post}
          <li>
            <a
              href="/blog/{post.slug}"
              class="group block"
            >
              <span class="text-base font-normal tracking-wide group-hover:text-[var(--accent)] transition-colors" style="color: var(--text-primary);">
                {post.title}
              </span>
              {#if post.excerpt}
                <p class="text-sm mt-1" style="color: var(--text-ghost);">
                  {post.excerpt}
                </p>
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
