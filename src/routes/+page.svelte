<script lang="ts">
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';
	import favicon from '$lib/assets/favicon.svg';

	const contactHref = 'mailto:mharris@darcstar.tech';

	const readouts = [
		{ v: '0.767 µs', l: 'CfC inference' },
		{ v: '13,000×', l: 'real-time' },
		{ v: '∞', l: 'domains possible' },
		{ v: 'proven', l: 'machine-checked' }
	];
	const pillars = [
		{
			cvar: 'var(--charge-r)',
			icon: 'shield',
			title: 'Provably safe',
			body: 'Control Barrier Functions, machine-checked in Lean 4 and Isabelle. Not tested — proven.'
		},
		{
			cvar: 'var(--charge-b)',
			icon: 'bolt',
			title: 'Real-time',
			body: 'Closed-form continuous-time inference at 0.767 µs — 13,000× ahead of the world.'
		},
		{
			cvar: 'var(--charge-g)',
			icon: 'cycle',
			title: 'Self-improving',
			body: 'Neuroevolution and an autonomous Self-Dev loop that writes and verifies its own code.'
		}
	];
	const domains = [
		{ n: 'Cart-pole control', d: '3D cart-pole balancing with machine-checked CBF safety proofs.' },
		{ n: 'Quadrotor flight', d: '6-DOF quadrotors with hybrid CfC / LQR / MPC control.' },
		{ n: 'Financial markets', d: 'Live FX trading, a 36-objective curriculum, Oanda connector.' },
		{ n: 'Language models', d: 'Entropy, grounding, and safety regulation for LLM control.' },
		{ n: 'Autonomous software', d: 'A Self-Dev loop that specs, builds, and verifies itself.' }
	];
</script>

{#snippet icon(name: string)}
	<svg
		class="size-5"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#if name === 'shield'}
			<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
			<path d="M9 12l2 2 4-4" />
		{:else if name === 'bolt'}
			<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
		{:else if name === 'cycle'}
			<path d="M21 12a9 9 0 1 1-3-6.7" />
			<path d="M21 3v5h-5" />
		{/if}
	</svg>
{/snippet}

{#snippet sectionHead(kicker: string, heading: string)}
	<div class="p-8 text-center sm:p-10">
		<p class="font-mono text-xs tracking-[0.25em] text-white/35 uppercase">{kicker}</p>
		<h2 class="mx-auto mt-3 max-w-3xl text-3xl font-medium tracking-tight text-white">{heading}</h2>
	</div>
{/snippet}

<CosmicBackdrop />

<div class="space-y-24">
	<section
		class="-mt-10 flex min-h-[calc(100svh-4rem)] flex-col items-center px-6 pt-6 pb-20 text-center sm:pt-8"
	>
		<p class="font-mono text-sm tracking-[0.3em] text-white/40 uppercase">
			GIDE · Guaranteed Intelligent Dynamics Engine
		</p>

		<!-- The twisting triple helix centres in this gap; CosmicBackdrop measures
		     #helix-slot to place and size it responsively. -->
		<div id="helix-slot" class="flex-1"></div>

		<div
			class="glass-panel mx-auto w-full max-w-3xl rounded-2xl px-8 py-10 text-center sm:px-10 sm:py-12"
		>
			<h1 class="text-4xl font-medium tracking-tight text-balance text-white sm:text-6xl">
				Autonomous control you can
				<span class="charge-flow">prove</span>
				is safe.
			</h1>
			<p class="mx-auto mt-6 max-w-xl text-base text-white/55 sm:text-lg">
				GIDE is a real-time intelligent control engine with formal safety guarantees — one system,
				proven across robotics, markets, and software that improves itself.
			</p>
			<div class="mt-9 flex flex-wrap justify-center gap-3">
				<a
					href="#gide"
					class="glass-btn rounded-full px-6 py-2.5 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/10"
					>Explore GIDE</a
				>
				<a
					href={contactHref}
					class="glass-btn rounded-full px-6 py-2.5 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/10"
					>Get in touch →</a
				>
			</div>
		</div>
	</section>

	<div class="mx-auto max-w-5xl space-y-16">
		<div
			class="glass-panel flex flex-wrap items-center justify-center gap-x-12 gap-y-4 rounded-2xl px-8 py-7 text-center"
		>
			{#each readouts as ro (ro.l)}
				<div>
					<div class="font-mono text-lg text-white sm:text-xl">{ro.v}</div>
					<div class="mt-0.5 font-mono text-[11px] tracking-widest text-white/40 uppercase">
						{ro.l}
					</div>
				</div>
			{/each}
		</div>

		<section id="gide" class="glass-panel scroll-mt-24 overflow-hidden rounded-2xl">
			{@render sectionHead(
				'// intelligence with guarantees',
				'Nearly 1 M lines and counting of Zig, C++, Rust, and Python w/ custom CUDA Kernels'
			)}
			<div
				class="grid divide-y divide-white/10 border-t border-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0"
			>
				{#each pillars as p (p.title)}
					<div class="p-7">
						<div
							class="flex size-10 items-center justify-center rounded-lg"
							style="color: {p.cvar}; background: color-mix(in oklab, {p.cvar} 12%, transparent);"
						>
							{@render icon(p.icon)}
						</div>
						<h3 class="mt-5 text-base font-medium text-white">{p.title}</h3>
						<p class="mt-2 text-sm leading-relaxed text-white/55">{p.body}</p>
					</div>
				{/each}
			</div>
		</section>

		<section class="glass-panel overflow-hidden rounded-2xl">
			{@render sectionHead('// one engine, infinite domains', 'Specialized at compile time')}
			<div class="divide-y divide-white/10 border-t border-white/10">
				{#each domains as d (d.n)}
					<div class="flex flex-col gap-1 px-8 py-5 sm:flex-row sm:items-baseline sm:gap-6">
						<div class="w-52 shrink-0 text-sm font-medium text-white">{d.n}</div>
						<div class="text-sm text-white/50">{d.d}</div>
					</div>
				{/each}
			</div>
		</section>

		<section class="glass-panel rounded-2xl p-10 text-center sm:p-16">
			<h2 class="text-2xl font-medium tracking-tight text-white sm:text-3xl">
				Proven, not just tested.
			</h2>
			<p class="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/55 sm:text-base">
				Every safety guarantee is machine-checked through a formal-verification pipeline — Lean 4,
				Isabelle, and SMT solvers. When GIDE says a system is safe, there is a proof.
			</p>
		</section>

		<section class="glass-panel rounded-2xl px-8 py-14 text-center">
			<h2 class="text-3xl font-medium tracking-tight text-white sm:text-4xl">
				Let's build something guaranteed.
			</h2>
			<p class="mx-auto mt-4 max-w-lg text-sm text-white/55">
				Safety-critical control, autonomous systems, formal methods — we'd like to hear from you.
			</p>
			<a
				href={contactHref}
				class="glass-btn mt-8 inline-flex items-center gap-2.5 rounded-full px-6 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/10"
			>
				<img src={favicon} alt="" class="logo-spin size-5" />
				Contact Us
			</a>
		</section>
	</div>
</div>
