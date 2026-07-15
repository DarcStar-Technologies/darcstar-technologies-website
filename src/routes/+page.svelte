<script lang="ts">
	import CosmicBackdrop from '$lib/components/CosmicBackdrop.svelte';

	const readouts = [
		{ v: '0.767 µs', l: 'CfC inference' },
		{ v: '13,000×', l: 'real-time' },
		{ v: '∞', l: 'shipped domains' },
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
			cvar: 'var(--charge-g)',
			icon: 'bolt',
			title: 'Real-time',
			body: 'Closed-form continuous-time inference at 0.767 µs — 13,000× ahead of the world.'
		},
		{
			cvar: 'var(--charge-b)',
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

<CosmicBackdrop />

<div class="space-y-28">
	<section class="flex min-h-[78vh] flex-col items-center justify-center py-20 text-center">
		<p class="font-mono text-xs tracking-[0.3em] text-white/40 uppercase">
			GIDE · Guaranteed Intelligent Dynamics Engine
		</p>
		<h1
			class="mt-6 max-w-3xl text-4xl font-medium tracking-tight text-balance text-white sm:text-6xl"
		>
			Autonomous control you can
			<span
				class="bg-clip-text text-transparent"
				style="background-image: linear-gradient(90deg, var(--charge-r), var(--charge-g), var(--charge-b));"
				>prove</span
			>
			is safe.
		</h1>
		<p class="mx-auto mt-6 max-w-xl text-base text-white/55 sm:text-lg">
			GIDE is a real-time intelligent control engine with formal safety guarantees — one system,
			proven across robotics, markets, and software that improves itself.
		</p>
		<div class="mt-9 flex flex-wrap justify-center gap-3">
			<a
				href="#gide"
				class="rounded-full border border-white/15 bg-white/5 px-6 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition hover:border-white/30 hover:bg-white/10"
				>Explore GIDE</a
			>
			<a
				href="mailto:mharris@darcstar.tech"
				class="rounded-full px-6 py-2.5 text-sm font-medium text-white/60 transition hover:text-white"
				>Get in touch →</a
			>
		</div>
	</section>

	<div class="mx-auto max-w-5xl space-y-28">
		<div
			class="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 border-y border-white/10 py-6 text-center"
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

		<section id="gide" class="scroll-mt-24">
			<p class="text-center font-mono text-xs tracking-[0.25em] text-white/35 uppercase">
				// intelligence with guarantees
			</p>
			<h2 class="mt-3 text-center text-3xl font-medium tracking-tight text-white">
				A ~715K-line hybrid Zig / C++ runtime
			</h2>
			<div
				class="mt-12 grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-3"
			>
				{#each pillars as p (p.title)}
					<div class="bg-white/[0.02] p-7 backdrop-blur-sm">
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

		<section>
			<p class="text-center font-mono text-xs tracking-[0.25em] text-white/35 uppercase">
				// one engine, infinite domains
			</p>
			<h2 class="mt-3 text-center text-3xl font-medium tracking-tight text-white">
				Specialized at compile time
			</h2>
			<div class="mt-10 divide-y divide-white/10 border-y border-white/10">
				{#each domains as d (d.n)}
					<div class="flex flex-col gap-1 py-5 sm:flex-row sm:items-baseline sm:gap-6">
						<div class="w-52 shrink-0 text-sm font-medium text-white">{d.n}</div>
						<div class="text-sm text-white/50">{d.d}</div>
					</div>
				{/each}
			</div>
		</section>

		<section
			class="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center backdrop-blur-sm sm:p-16"
			style="background-image: radial-gradient(80% 120% at 50% 0%, color-mix(in oklab, var(--charge-b) 12%, transparent), transparent 70%);"
		>
			<h2 class="text-2xl font-medium tracking-tight text-white sm:text-3xl">
				Proven, not just tested.
			</h2>
			<p class="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/55 sm:text-base">
				Every safety guarantee is machine-checked through a formal-verification pipeline — Lean 4,
				Isabelle, and SMT solvers. When GIDE says a system is safe, there is a proof.
			</p>
		</section>

		<section class="pb-8 text-center">
			<h2 class="text-3xl font-medium tracking-tight text-white sm:text-4xl">
				Let's build something guaranteed.
			</h2>
			<p class="mx-auto mt-4 max-w-lg text-sm text-white/55">
				Safety-critical control, autonomous systems, formal methods — we'd like to hear from you.
			</p>
			<a
				href="mailto:mharris@darcstar.tech"
				class="mt-8 inline-block rounded-full border border-white/15 bg-white/5 px-7 py-3 text-sm font-medium text-white backdrop-blur-sm transition hover:border-white/30 hover:bg-white/10"
				>Contact DarcStar</a
			>
		</section>
	</div>
</div>
