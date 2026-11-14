<script lang="ts">
	export let region = 0;
	export let scene = 0;
	export let speaker = '';
	export let changed = false;
	export let reducedMotion = false;

	const rows = Array.from({ length: 8 }, (_, i) => i);
	const columns = Array.from({ length: 12 }, (_, i) => i);
	$: area = Number.isFinite(region) ? ((Math.trunc(region) % 9) + 9) % 9 : 0;
	$: place = Number.isFinite(scene) ? ((Math.trunc(scene) % 5) + 5) % 5 : 0;
	$: character = speaker.includes('栞') ? '栞' : speaker.includes('白榆') ? '白榆' : speaker.includes('岑') ? '岑' : speaker.includes('季') ? '季' : '';
	$: pose = (place + (changed ? 1 : 0)) % 6;
</script>

<div class="backdrop" class:reduced={reducedMotion} class:changed aria-hidden="true">
	<svg class="world" viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect width="1200" height="760" fill="#141414" />
		<!-- Each district has an architectural grammar; each location has a separate focal object. -->
		{#if area === 0}
			<path d="M0 95H1200V125H0ZM0 505H1200V555H0" fill="#383838" />
			<path d="M70 505V248Q70 95 218 95H982Q1130 95 1130 248V505" stroke="#aaa" stroke-width="3" />
			{#each columns as x}
				<path d={`M${x * 112 - 16} 110L600 565M${x * 112 - 16} 760L600 505`} stroke="#444" />
			{/each}
			<path d="M0 650L530 505H670L1200 650M0 705L555 505M1200 705L645 505" stroke="#aaa" stroke-width="3" />
			{#if place === 0}
				<rect x="360" y="195" width="480" height="355" fill="#292929" stroke="#bbb" />
				<path d="M410 485V310A190 105 0 0 1 790 310V485Z" fill="#090909" stroke="#777" />
				{#each rows as x}<path d={`M${438 + x * 46} 240V440`} stroke="#626262" />{/each}
				<path d="M335 485H865L890 510H310Z" fill="#a9a9a9" />
				<path d="M535 471L641 446L701 467L592 491Z" fill="#eee" /><circle cx="621" cy="468" r="9" fill="#141414" />
			{:else if place === 1}
				{#each [0, 1, 2] as x}<path d={`M${310 + x * 190} 395h150v65H${310 + x * 190}zm15 65v70m120-70v70`} fill="#252525" stroke="#999" stroke-width="3" />{/each}
				<path d="M480 175H720V335H480Z" fill="#d3d3d3" /><path d="M505 290L560 220L620 265L690 200M560 220V315" stroke="#222" stroke-width="3" />
				{#each [0, 1, 2, 3] as x}<circle cx={510 + x * 57} cy={285 - x * 22} r="5" fill="#222" />{/each}
			{:else if place === 2}
				<path d="M335 475L435 350H780L870 475V565H335Z" fill="#333" stroke="#aaa" />
				{#each [0, 1, 2, 3, 4] as x}<path d={`M${440 + x * 66} 388v51m-13-20h26`} stroke="#ddd" stroke-width="3" /><circle cx={441 + x * 66} cy={390 + (x % 3) * 18} r="8" fill="#ddd" />{/each}
				<circle cx="600" cy="255" r="61" stroke="#aaa" /><circle cx="600" cy="255" r="46" stroke="#555" /><path d="M600 255L632 219" stroke="#eee" stroke-width="3" />
				<path d="M368 540C280 640 735 565 822 640" stroke="#999" stroke-width="4" />
			{:else if place === 3}
				<path d="M100 265H1010L1110 350V485H100Z" fill="#444" stroke="#ddd" />
				{#each columns.slice(0, 8) as x}<rect x={145 + x * 108} y="296" width="77" height="88" fill="#111" stroke="#777" />{/each}
				<path d="M510 484V300H650V484M525 315H635V395H525Z" stroke="#ccc" />
				<path d="M510 484L456 525H705L650 484" fill="#929292" /><path d="M30 570H1160" stroke="#eee" stroke-dasharray="4 15" />
			{:else}
				<path d="M380 195H820V555H380Z" fill="#242424" stroke="#aaa" />
				{#each [0, 1, 2] as y}{#each [0, 1, 2, 3] as x}<rect x={394 + x * 106} y={210 + y * 110} width="94" height="98" stroke="#666" /><path d={`M${426 + x * 106} ${255 + y * 110}h26m-8 8h8`} stroke="#ccc" />{/each}{/each}
				<path d="M610 430L700 411V520L610 528Z" fill="#bcbcbc" stroke="#eee" /><path d="M645 464l28 4-4 30-29-5z" fill="#333" />
			{/if}
		{:else if area === 1}
			<path d="M0 545V180L180 105L350 187V545M1200 545V135L990 200L880 175V545" fill="#2c2c2c" stroke="#666" />
			<path d="M350 180L460 285V515L350 545M880 175L754 286V515L880 545" fill="#202020" stroke="#555" />
			{#each rows as y}<path d={`M0 ${240 + y * 34}H350M880 ${220 + y * 40}H1200`} stroke="#363636" />{/each}
			<path d="M0 760L480 505H720L1200 760M450 760L560 505M770 760L650 505" stroke="#757575" /><path d="M100 165Q600 325 1080 120" stroke="#999" />
			{#if place === 0}
				<path d="M315 322L370 238H805L860 322Z" fill="#c8c8c8" />
				{#each [0, 1, 2, 3, 4] as x}<path d={`M${367 + x * 86} 239l-25 83h45l20-83z`} fill="#474747" />{/each}
				<path d="M343 321V547M833 321V547M370 475H800L830 502H340Z" fill="#999" stroke="#aaa" stroke-width="4" />
				<path d="M492 426h43v43h-43zm43 5h13v23h-13M575 437h47v33h-47zm47 5h12v17h-12M690 433v-30h32v31l14 26h-60z" fill="#ddd" stroke="#222" />
				<path d="M508 412q-15-20 0-34M596 427q15-20 0-35" stroke="#777" />
			{:else if place === 1}
				<path d="M601 210V620" stroke="#bbb" stroke-width="12" /><path d="M395 254H790L832 292L790 328H395Z" fill="#ddd" /><path d="M415 278H685M415 302H746" stroke="#333" stroke-width="5" />
				<path d={changed ? 'M410 344H748V390H410Z' : 'M428 360L730 339L735 384L433 405Z'} fill="#555" stroke="#aaa" /><path d="M453 372H655" stroke="#ddd" stroke-width="3" />
				<path d="M525 601L600 581L680 601L600 622Z" fill="#777" />
			{:else if place === 2}
				<path d="M345 160H855V559H345Z" fill="#414141" stroke="#aaa" /><path d="M375 185H825V247H375Z" fill="#171717" /><path d="M442 211H761M480 225H720" stroke="#bbb" />
				<path d="M380 270H610V520H380Z" fill="#1a1a1a" stroke="#888" />
				{#each [0, 1, 2, 3] as y}<path d={`M388 ${320 + y * 55}H600`} stroke="#999" />{#each rows as x}<path d={`M${400 + x * 24} ${281 + y * 55}v35`} stroke={x % 2 ? '#555' : '#aaa'} stroke-width={x % 3 === 0 ? 9 : 5} />{/each}{/each}
				<path d={changed ? 'M640 270H812V550H640Z' : 'M640 270L791 300V550L640 528Z'} fill="#111" stroke="#bcbcbc" /><rect x="673" y="329" width="92" height="97" fill="#bbb" /><path d="M687 351h61m-61 16h48m-48 16h60m-60 16h35" stroke="#333" />
			{:else if place === 3}
				<path d="M310 480L450 330H755L904 480L786 572H394Z" fill="#5e5e5e" stroke="#ccc" /><path d="M365 457L467 352H736L841 464L759 531H448Z" fill="#d1d1d1" />
				<path d="M461 450L522 385L598 416L668 375L774 458L695 490L619 450L558 494Z" stroke="#454545" stroke-width="3" /><path d="M581 366L594 506M445 471L735 421" stroke="#888" stroke-dasharray="6 7" />
				<path d="M400 565V644M789 570V635" stroke="#888" stroke-width="10" /><path d="M703 472l24-10 9 8-25 11z" fill="#111" />
			{:else}
				<path d="M260 590L600 427L960 590M330 235V595M870 205V595M330 255Q590 305 870 225M330 346Q610 385 870 318" stroke="#aaa" stroke-width="3" />
				{#each [0, 1, 2, 3] as x}<path d={`M${368 + x * 116} ${272 + Math.sin(x) * 14}l87 5-9 98-83-9z`} fill={x % 2 ? '#aaa' : '#ddd'} /><path d={`M${380 + x * 116} ${265 + Math.sin(x) * 14}v17`} stroke="#111" stroke-width="6" />{/each}
				<path d="M405 365l133 8-14 119-126-9zM674 363l133-9 10 114-130 16z" fill="#8b8b8b" />
			{/if}
		{:else if area === 2}
			<path d="M0 40L420 175V570L0 700M1200 40L780 175V570L1200 700" fill="#292929" stroke="#666" />
			{#each rows as y}<path d={`M0 ${105 + y * 70}L420 ${208 + y * 45}M1200 ${105 + y * 70}L780 ${208 + y * 45}`} stroke="#777" />{/each}
			{#each [0, 1, 2] as x}<path d={`M${90 + x * 125} 78V655M${1110 - x * 125} 78V655`} stroke="#555" />{/each}
			<path d="M420 175H780V570H420Z" fill="#0c0c0c" /><path d="M0 760L420 570H780L1200 760" stroke="#aaa" />
			{#if place === 0}
				<path d="M330 360H870V570H330Z" fill="#494949" stroke="#aaa" /><path d="M374 404H825V448H374Z" fill="#0b0b0b" /><path d="M385 424L547 388L620 431L452 465Z" fill="#ddd" />
				<path d="M605 221H783V368H605Z" fill="#aaa" /><path d="M623 245h140m-140 21h110m-110 21h137m-137 45h70" stroke="#333" /><path d="M683 489h96v40h-96z" stroke="#bbb" />
			{:else if place === 1}
				<path d="M365 185H835V559H365Z" fill="#383838" stroke="#999" />
				{#each [0, 1, 2] as y}<path d={`M387 ${205 + y * 108}H813V${299 + y * 108}H387Z`} stroke="#888" /><rect x="569" y={240 + y * 108} width="62" height="21" stroke="#ccc" />{/each}
				<path d="M387 407L330 500V584H870V500L813 407Z" fill="#5b5b5b" stroke="#bbb" /><path d="M360 489L414 425H576V498H360ZM602 498V425H785L839 489Z" fill="#d9d9d9" />
				<path d="M475 488v53h62v-53M652 488v53h62v-53" fill={changed ? '#eee' : '#969696'} stroke="#222" />
			{:else if place === 2}
				<path d="M287 522L398 365H806L913 522V558H287Z" fill="#575757" stroke="#bbb" /><path d="M420 381H577L548 487H361ZM619 381H777L840 487H627Z" fill="#ddd" />
				{#each [0, 1, 2, 3] as y}<path d={`M${426 - y * 9} ${404 + y * 18}h102M${642 + y * 2} ${404 + y * 18}h99`} stroke="#777" />{/each}
				<circle cx="643" cy="343" r="48" fill="#111" fill-opacity="0.5" stroke="#eee" stroke-width="6" /><path d="M677 376L732 430" stroke="#ccc" stroke-width="12" />
				<path d="M485 365V224H694L724 302H573" stroke="#999" stroke-width="4" /><path d="M687 288h63l-11 26h-62z" fill="#ccc" />
			{:else if place === 3}
				<path d="M385 174H815V577H385Z" fill="#3f3f3f" stroke="#aaa" /><path d="M600 187V562M407 320H790M407 448H790" stroke="#aaa" />
				{#each [0, 1, 2] as y}<path d={`M432 ${211 + y * 127}h121v77H432zM641 ${211 + y * 127}h121v77H641z`} fill="#111" stroke="#888" /><path d={`M453 ${232 + y * 127}h80m-80 13h65M662 ${232 + y * 127}h80m-80 13h65`} stroke="#ddd" />{/each}
				<path d="M555 535h90v37h-90z" fill="#ccc" /><path d="M575 545h51m-51 11h42" stroke="#333" />
			{:else}
				<path d="M370 255H830V553H370Z" fill="#313131" stroke="#777" />
				{#each [0, 1, 2] as y}{#each [0, 1, 2] as x}<path d={`M${385 + x * 149} ${272 + y * 89}h128v72h-128z`} stroke="#999" /><path d={`M${389 + x * 149} ${278 + y * 89}l60 42 60-42`} stroke="#777" />{/each}{/each}
				<path d="M479 477L650 451L731 544L556 574Z" fill="#ddd" /><path d="M493 483L610 521L647 462M610 521L722 542" stroke="#444" />
				<path d="M538 209Q601 178 662 209V234H538Z" fill="#aaa" />
			{/if}
		{:else if area === 3}
			<path d="M120 0H1080L949 130H251Z" fill="#777" /><path d="M160 65H1035V493H160Z" stroke="#aaa" stroke-width="4" />
			<path d="M180 80H353L322 275L252 442H180ZM1020 80H847L878 275L948 442H1020Z" fill="#363636" stroke="#666" />
			{#each [0, 1, 2, 3] as x}<path d={`M${204 + x * 35} 85Q${260 + x * 28} 230 ${196 + x * 22} 428M${996 - x * 35} 85Q${940 - x * 28} 230 ${1004 - x * 22} 428`} stroke="#555" />{/each}
			<path d="M160 493H1040L1200 653H0Z" fill="#484848" /><path d="M0 653H1200M70 593H1130M123 540H1077" stroke="#999" />
			{#if place === 0}
				<path d="M350 250H590V516H350Z" fill="#171717" stroke="#ccc" /><path d="M382 285H555V388H382Z" stroke="#999" /><path d="M328 426H612V447H328Z" fill="#bbb" />
				<path d="M658 264H835V472H658Z" fill="#c5c5c5" /><path d="M680 286H810V373H680Z" fill="#343434" /><path d="M680 399h132m-132 19h100m-100 19h124" stroke="#555" />
				<path d="M395 569V501M807 569V501M395 509Q600 555 807 509" stroke="#aaa" stroke-width="4" />
			{:else if place === 1}
				{#each [0, 1, 2] as y}{#each [-2, -1, 0, 1, 2] as x}<path d={`M${566 + x * (93 + y * 16)} ${346 + y * 85}q0-26 34-26t34 26v39h-68z`} fill="#141414" stroke="#929292" /><path
							d={`M${575 + x * (93 + y * 16)} ${382 + y * 85}v18m50-18v18`}
							stroke="#777"
						/>{/each}{/each}
				<path d="M559 464l52-9 18 27-56 11z" fill="#eee" />
			{:else if place === 2}
				<path d="M510 478L603 129L713 478Z" fill="#ddd" fill-opacity="0.08" /><path d="M454 482H745M600 95V285" stroke="#aaa" />
				<path d="M502 405V329Q527 302 550 329V405M500 364H552M508 405V466M544 405V466" stroke="#bbb" stroke-width="6" /><path d="M631 449h93v15h-93zm8 15v33m77-33v33" fill="#777" />
				<path d="M360 491l70-8m340 8 70-8M600 375l15 15-15 15-15-15z" stroke="#eee" />
			{:else if place === 3}
				<path d="M375 196H813V471H375Z" fill="#555" stroke="#ddd" stroke-width="6" /><path d="M399 219H789V445H399Z" fill="#1a1a1a" />
				<path d="M420 436L578 223M506 444L663 223M711 444L780 350" stroke="#333" stroke-width="16" /><path d="M367 492H824V524H367Z" fill="#aaa" />
				{#each [0, 1, 2, 3, 4, 5] as x}<circle cx={403 + x * 76} cy="181" r="6" fill="#ddd" />{/each}
				<path d="M588 269a23 23 0 1 0 0 46a23 23 0 1 0 0-46M570 317L546 424H638L613 317Z" fill="#060606" stroke="#777" />
			{:else}
				<path d="M580 145V640M680 145V640" stroke="#aaa" stroke-width="8" />{#each rows as y}<path d={`M580 ${195 + y * 55}H680`} stroke="#999" stroke-width="6" />{/each}
				<path d="M330 197l177 16-15 230-177-16z" fill="#999" /><path d="M352 226l127 12-12 107-124-11z" fill="#222" /><path d="M350 372l116 10m-117 12 78 6" stroke="#222" stroke-width="3" />
				<path d="M755 269l143-17 21 182-145 17z" fill="#555" stroke="#aaa" /><path d="M780 295l93-10m-89 36 73-8m-69 35 82-9" stroke="#bbb" />
			{/if}
		{:else if area === 4}
			{#each [0, 1, 2, 3, 4] as x}<circle cx="600" cy="340" r={140 + x * 67} stroke={x % 2 ? '#555' : '#333'} stroke-width={x % 2 ? 3 : 15} />{/each}
			{#each columns as x}<path d="M600 55V91" stroke="#aaa" stroke-width="3" transform={`rotate(${x * 30} 600 340)`} />{/each}
			<path d="M0 688L445 510H755L1200 688M300 760L490 510M900 760L710 510" stroke="#777" />
			{#if place === 0}
				{#each [{ x: 505, y: 365, r: 113 }, { x: 716, y: 283, r: 88 }] as gear}<circle cx={gear.x} cy={gear.y} r={gear.r} stroke="#aaa" stroke-width="19" stroke-dasharray="12 13" /><circle
						cx={gear.x}
						cy={gear.y}
						r={gear.r - 21}
						stroke="#666"
						stroke-width="8"
					/><circle cx={gear.x} cy={gear.y} r="20" fill="#aaa" />{#each [0, 1, 2, 3, 4, 5] as spoke}<path
							d={`M${gear.x} ${gear.y}v${gear.r - 25}`}
							stroke="#777"
							stroke-width="8"
							transform={`rotate(${spoke * 60} ${gear.x} ${gear.y})`}
						/>{/each}{/each}
				<path d="M390 531h400" stroke="#ddd" stroke-width="3" />
			{:else if place === 1}
				<path d="M483 157V325Q483 405 434 428H766Q717 405 717 325V157Z" fill="#494949" stroke="#bbb" /><path d="M444 416H756V437H444Z" fill="#aaa" /><circle cx="600" cy="450" r="19" fill="#ddd" />
				<path d="M600 95V450M600 470V601" stroke="#aaa" /><path d="M452 472Q600 565 748 472M420 500Q600 623 780 500" stroke="#888" />
			{:else if place === 2}
				<path d="M315 466L430 327H772L896 466V536H315Z" fill="#4a4a4a" stroke="#aaa" /><path d="M439 350H524L493 573H407ZM629 350H715L767 573H681Z" fill="#d2d2d2" />
				{#each rows as y}<path d={`M${447 - y * 3} ${375 + y * 23}h39M${640 + y * 5} ${375 + y * 23}h40`} stroke="#555" />{/each}
				<circle cx="600" cy="250" r="58" fill="#202020" stroke="#aaa" /><path d="M600 215V252L635 270" stroke="#eee" stroke-width="3" /><path d="M599 308V400" stroke="#aaa" />
			{:else if place === 3}
				<path d="M290 557V383M910 557V383M290 411H910M290 463H910" stroke="#aaa" stroke-width="5" />{#each rows as x}<path d={`M${335 + x * 76} 412V555`} stroke="#777" />{/each}
				<path d="M408 187H789V215H408ZM600 214V374" stroke="#ccc" stroke-width="5" /><circle cx="600" cy="394" r="33" fill="#aaa" /><path d="M470 564H730L787 591H413Z" fill="#999" />
			{:else}
				<path d="M380 340L600 172L820 340V563H380Z" fill="#272727" stroke="#999" /><path d="M415 351L600 214L785 351" stroke="#555" />
				<circle cx="600" cy="360" r="87" stroke="#ddd" stroke-width="5" /><circle cx="600" cy="360" r="72" stroke="#666" /><path d="M600 295V360H648" stroke="#ddd" stroke-width="5" /><path d="M563 488h73v24h-73zM536 539h123" stroke="#999" />
			{/if}
		{:else if area === 5}
			<path d="M0 342L137 300L243 337L342 289L496 343L648 296L770 320L907 267L1045 316L1200 286V448H0Z" fill="#333" />
			<path d="M0 445H1200V760H0Z" fill="#090909" />
			{#each rows as y}<path d={`M${y % 2 ? 10 : 97} ${474 + y * 37}h${380 + y * 12}m75 0h${500 - y * 30}`} stroke={y % 2 ? '#555' : '#333'} />{/each}
			<path d="M275 149L439 425M963 129L783 425" stroke="#252525" stroke-width="72" />
			{#if place === 0}
				<path d="M334 184H408V575H334ZM792 184H866V575H792Z" fill="#555" stroke="#aaa" /><path d="M408 222H792V427H408Z" fill="#292929" stroke="#777" />
				{#each rows as y}<path d={`M417 ${239 + y * 24}H783`} stroke="#888" />{/each}
				<circle cx="600" cy="257" r="64" stroke="#ddd" stroke-width="6" /><path d="M536 257H664M600 193V321M600 322V500" stroke="#aaa" stroke-width="4" /><path d="M452 480Q600 500 748 480M476 499Q600 522 724 499" stroke="#ddd" />
			{:else if place === 1}
				<path d="M0 649L449 453L640 483L792 617L1200 754H0Z" fill="#464646" />
				{#each [{ x: 416, y: 429, r: -14 }, { x: 578, y: 499, r: 20 }, { x: 718, y: 391, r: -9 }, { x: 830, y: 515, r: 6 }] as paper}<g transform={`translate(${paper.x} ${paper.y}) rotate(${paper.r})`}
						><path d="M0 0H85L114 20V64H0Z" fill="#bcbcbc" /><path d="M85 0V20H114M14 23H68M14 35H90M14 47H58" stroke="#444" /></g
					>{/each}
				<path d="M326 584Q603 601 826 638" stroke="#aaa" />
			{:else if place === 2}
				<path d="M370 547V237Q600 73 830 237V547Z" fill="#111" stroke="#888" stroke-width="8" /><path d="M401 527V260Q600 127 799 260V527Z" stroke="#444" stroke-width="4" />
				<path d="M455 383H747V494H455Z" fill="#444" stroke="#aaa" /><path d="M473 350H728V390H473Z" fill="#ddd" /><path d="M495 360h193m-193 14h150" stroke="#555" /><path d="M478 515L741 515L712 578H506Z" fill="#999" fill-opacity="0.25" />
			{:else if place === 3}
				<path d="M228 760L522 404H673L973 760Z" fill="#414141" stroke="#888" />{#each rows as y}<path d={`M${509 - y * 31} ${432 + y * 43}H${688 + y * 34}`} stroke="#777" />{/each}
				<path d="M497 465V375M712 465V375M345 644V526M869 644V526" stroke="#999" stroke-width="12" /><path d="M570 390V302H637V390M570 349H637M579 389V422M628 389V422" stroke="#bbb" stroke-width="4" /><path
					d="M651 424l68-5 28 19-73 8z"
					fill="#ddd"
				/>
			{:else}
				<path d="M333 562V285L600 143L867 285V562ZM333 285H867M467 217V562M600 143V562M733 217V562M333 408H867" stroke="#888" stroke-width="3" /><path d="M350 565H850" stroke="#ccc" />
				{#each [0, 1, 2, 3] as x}<path d={`M${414 + x * 121} 529v-75q-58-30-36-65q54 0 36 65q13-50 44-48q25 39-44 48M${390 + x * 121} 529h49l-9 31h-32z`} fill="#444" stroke="#aaa" />{/each}
			{/if}
		{:else if area === 6}
			<path d="M0 65L443 213H757L1200 65M0 670L443 497H757L1200 670" stroke="#888" />
			{#each [0, 1, 2, 3] as x}<path d={`M${70 + x * 111} ${85 + x * 35}V${644 - x * 43}M${1130 - x * 111} ${85 + x * 35}V${644 - x * 43}`} stroke="#444" stroke-width="21" />{/each}
			<path d="M438 215V495H762V215Z" fill="#202020" stroke="#666" />
			{#if place === 0}
				<path d="M477 245H723V493H477Z" fill="#060606" stroke="#aaa" /><path d="M520 265V476M564 265V476M608 265V476M652 265V476M696 265V476" stroke="#444" />
				<path d="M350 135L603 198L850 133M350 156L603 219L850 154M350 177L603 240L850 175" stroke="#999" /><path d="M430 507L342 596H813L768 534H518" stroke="#888" stroke-width="4" />
			{:else if place === 1}
				<path d="M375 228H825V430H375Z" fill="#090909" stroke="#aaa" stroke-width="7" /><path d="M396 253H560V408H396ZM580 253H800V324H580ZM580 344H800V408H580Z" stroke="#777" />
				{#each [0, 1, 2, 3, 4] as y}<path d={`M414 ${273 + y * 24}h${103 - (y % 3) * 19}M602 ${268 + y * 27}h${145 - (y % 2) * 35}`} stroke="#aaa" />{/each}
				<path d="M375 454H825L883 527H317Z" fill="#656565" stroke="#bbb" /><path d="M468 471H731L754 510H446Z" stroke="#333" /><path d="M600 527V606" stroke="#aaa" stroke-width="22" />
			{:else if place === 2}
				{#each [-1, 0, 1] as x}<path d={`M${538 + x * 161} 222h130v245h-130z`} fill={x === 0 ? '#d4d4d4' : '#818181'} />{#each rows as y}<path d={`M${552 + x * 161} ${247 + y * 26}h${99 - (y % 3) * 20}`} stroke="#333" />{/each}{/each}
				<path d="M405 486V533H603V486M603 533H797V486M603 533V585" stroke="#bbb" stroke-width="3" /><circle cx="603" cy="584" r="12" fill="#ccc" />
			{:else if place === 3}
				<path d="M280 483L470 330H727L920 483L709 603H471Z" fill="#454545" stroke="#aaa" /><path d="M356 478L487 367H711L850 478L697 561H485Z" stroke="#888" />
				{#each [{ x: 467, y: 427, h: 64 }, { x: 556, y: 476, h: 93 }, { x: 650, y: 422, h: 106 }, { x: 734, y: 475, h: 42 }] as block}<path d={`M${block.x} ${block.y}v-${block.h}l32-19 33 19v${block.h}l-33 20z`} fill="#858585" stroke="#ddd" /><path
						d={`M${block.x} ${block.y - block.h}l32 20 33-20m-33 20v${block.h}`}
						stroke="#444"
					/>{/each}
				<path d="M471 485L556 524L693 456L779 501" stroke="#ddd" stroke-dasharray="5 5" />
			{:else}
				<path d="M433 171H767V571H433Z" fill="#080808" stroke="#aaa" stroke-width="5" /><path d="M461 198H739V541H461Z" stroke="#555" />{#each rows as y}<path d={`M472 ${216 + y * 41}h256`} stroke="#555" stroke-dasharray="3 14" />{/each}
				<path d="M500 218V433Q500 485 559 485H654" stroke="#aaa" stroke-width="5" /><path d="M656 473h44v24h-44z" fill="#aaa" /><path d="M710 170L843 214V608L766 571" fill="#353535" stroke="#aaa" />
			{/if}
		{:else if area === 7}
			<path d="M0 460L146 284L303 421L400 231L547 371L702 196L874 381L1038 244L1200 387V760H0Z" fill="#2c2c2c" />
			<path d="M100 760L399 418L565 484L707 389L1055 760Z" fill="#515151" stroke="#999" /><path d="M399 418L408 760M707 389L765 760M547 371L580 111L702 196M874 381L925 128L1038 244" stroke="#777" />
			{#if place === 0}
				<path d="M270 666L489 440L566 491L513 569L555 591L496 666ZM705 417L635 489L666 506L629 552L922 666Z" fill="#7b7b7b" stroke="#ddd" /><path d="M502 554l38 58m126-100-44 78" stroke="#ddd" stroke-width="4" />
				<path d="M405 467L355 510M395 440L345 483" stroke="#ddd" stroke-width="6" /><path d="M395 433L380 520M362 462L415 494" stroke="#777" stroke-width="7" />
			{:else if place === 1}
				<path d="M449 664L575 514L448 347M495 681L628 514L773 313M425 648L545 514L421 365M517 699L657 514L799 337" stroke="#ccc" stroke-width="6" />
				<path d="M558 446V355H656V414H558" fill="#ddd" stroke="#aaa" /><path d="M574 374l-7 10 7 10m-7-10h29m33-10 7 10-7 10m7-10h-28" stroke="#222" stroke-width="3" />
			{:else if place === 2}
				{#each [0, 1, 2, 3, 4] as x}<path d={`M${275 + x * 54} ${650 - x * 34}V${236 + x * 25}H${925 - x * 54}V${650 - x * 34}`} stroke={x % 2 ? '#777' : '#bbb'} stroke-width="6" />{/each}
				<path d="M320 298L546 362L573 396L324 341ZM880 298L656 362L630 396L876 341Z" fill="#aaa" /><path d="M377 479Q600 427 821 479M418 494Q600 455 780 494" stroke="#ccc" />
			{:else if place === 3}
				<path d="M315 547L544 421H668L907 547L664 657H534Z" fill="#6b6b6b" stroke="#ccc" /><path d="M315 547V440L544 322H668L907 440V547M544 322V421M668 322V421M315 484L544 366H668L907 484" stroke="#ccc" stroke-width="4" />
				<path d="M587 498V438L657 407L679 434L616 461V509" fill="#202020" stroke="#ccc" /><circle cx="669" cy="419" r="21" fill="#444" stroke="#aaa" />
			{:else}
				<path d="M325 146H875V579H325Z" fill="#111" stroke="#aaa" stroke-width="10" /><path d="M351 172H849V548H351Z" fill="#323232" /><path d="M351 481L486 367L561 428L706 273L849 383V548H351Z" fill="#666" /><path
					d="M351 504L499 459L664 484L849 421M600 172V548M351 348H849"
					stroke="#bbb"
					stroke-width="6"
				/><path d="M300 580H900L849 615H351Z" fill="#aaa" />
			{/if}
		{:else}
			<rect x="180" y="70" width="840" height="620" fill="#b8b8b8" /><path d="M230 105H970V648H230Z" stroke="#777" />
			<path d="M120 130H200M180 50V150M1000 130H1080M1020 50V150M120 630H200M180 610V710M1000 630H1080M1020 610V710" stroke="#e8e8e8" stroke-width="3" />
			{#each rows as y}<path d={`M211 ${175 + y * 60}h12m755 0h12`} stroke="#444" />{/each}
			{#if place === 0}
				<path d="M417 190H783V572H417Z" fill="#242424" stroke="#111" /><path d="M440 216H760V555H440Z" stroke="#777" /><path d="M508 216V555M600 216V555M692 216V555" stroke="#aaa" stroke-dasharray="13 13" stroke-width="4" /><path
					d="M386 176H814V214H386Z"
					fill="#333"
				/>
				<path d="M417 573L327 643H873L783 573" fill="#777" /><path d="M566 197h67" stroke="#ddd" stroke-width="5" />
			{:else if place === 1}
				{#each [-1, 0, 1] as x}<path d={`M${554 + x * 160} 270h93v138h-93zM${543 + x * 160} 418h115v28h-115zM${555 + x * 160} 446v59m91-59v59`} fill="#333" stroke="#222" stroke-width="3" /><path
						d={`M${573 + x * 160} 291h55m-55 15h40`}
						stroke="#ccc"
					/>{/each}
				<path d="M354 535H846M440 200H760M600 200V248" stroke="#333" /><circle cx="600" cy="199" r="6" fill="#222" />
			{:else if place === 2}
				<path d="M323 473L441 287H759L877 473V526H323Z" fill="#555" stroke="#222" />
				{#each [0, 1, 2] as x}<path d={`M${459 + x * 91} 313h65l${x * 13 - 10} 116h-87z`} fill="#eee" /><path d={`M${466 + x * 91} 339h48m-50 18h47m-48 18h40`} stroke="#555" />{/each}
				<path d="M438 524V582M762 524V582" stroke="#333" stroke-width="10" /><path d="M697 458l53-10 4 9-53 10z" fill="#111" />
			{:else if place === 3}
				<path d="M420 149H779V600H420Z" fill="#e9e9e9" /><path d="M420 149H600V600H420Z" fill="#d1d1d1" /><path d="M600 149V600M420 601L290 690M779 601L904 690" stroke="#555" /><path
					d="M567 325V381M628 325V381"
					stroke="#555"
					stroke-width="4"
				/><path d="M347 648H852" stroke="#eee" />
			{:else}
				<path d="M386 219L599 181L814 219V561L599 523L386 561Z" fill="#dedede" stroke="#444" /><path d="M599 181V523M386 244L574 211M626 211L814 244" stroke="#777" /><path
					d="M430 293L550 272V449L430 470ZM646 272L767 293V470L646 449Z"
					stroke="#999"
				/><path d="M538 575H663" stroke="#444" />
			{/if}
		{/if}
		<!-- Paper edge / registration marks unite the original geometric assets. -->
		<path d="M32 62V32H62M1138 32H1168V62M32 698V728H62M1138 728H1168V698" stroke="#bcbcbc" opacity="0.45" />
		{#if changed}<path d="M570 650H630M580 660H620" stroke={area === 8 ? '#333' : '#ccc'} stroke-width="2" />{/if}
	</svg>
	<div class="atmosphere"></div>
	{#if character}
		<svg class="portrait" class:reflective={pose === 4} viewBox="0 0 280 500" fill="none" xmlns="http://www.w3.org/2000/svg">
			<ellipse cx="143" cy="487" rx="115" ry="12" fill="#050505" opacity="0.6" />
			{#if character === '栞'}
				<path d="M98 146Q65 124 74 75Q76 29 118 25Q168 15 185 66L187 151L163 169H96Z" fill="#080808" stroke="#777" />
				<path d="M98 73Q127 45 153 61L164 91L154 135L132 151L105 134Z" fill="#bcbcbc" /><path d="M86 79L104 52L111 101L123 62L159 89L171 77L160 47L109 40Z" fill="#080808" />
				<path d="M106 153L83 171L69 297L39 474Q137 505 225 474L200 293L179 172L152 154Z" fill="#111" stroke="#999" /><path d="M105 151L132 173L154 150L168 175L136 205L95 177Z" fill="#ddd" /><path d="M132 174L138 218L121 245L112 217Z" fill="#333" />
				<path d="M159 195V254L167 244L175 254V194ZM179 200V233L185 226L191 235V200Z" fill="#ddd" />
				<path d="M103 474L99 500M165 478L177 500" stroke="#111" stroke-width="21" />
				{#if pose === 0}<path d="M89 183L69 268L123 298L136 282L97 251L115 212M175 182L195 265L151 305L137 289L165 249L152 209" fill="#181818" stroke="#999" /><path d="M127 282l22 3 5 17-16 10-15-15" fill="#ccc" />
				{:else if pose === 1}<path d="M88 181L71 282L135 288L137 268L103 259L113 211M175 185L204 263L254 222L246 207L185 237L158 208" fill="#111" stroke="#999" /><path d="M246 209l6-23 11 1 5 30-14 9z" fill="#ccc" />
				{:else if pose === 2}<path d="M88 183L65 282L112 322L128 306L98 267L111 210M171 185L191 284L149 320L137 304L163 267L151 209" fill="#111" stroke="#999" /><path
						d="M103 278L147 292L179 279V327L144 340L103 326Z"
						fill="#ccc"
						stroke="#555"
					/><path d="M146 293V333" stroke="#555" />
				{:else if pose === 3}<path d="M88 182L70 277L108 293L124 279L100 257L112 211M176 181L204 288L167 328L154 313L178 278L154 212" fill="#111" stroke="#999" /><path d="M107 270l23 5 5 11-16 9-15-11" fill="#ccc" />
				{:else if pose === 4}<path d="M86 183L67 270L106 299L121 285L93 256L112 211M176 182L203 274L146 316L133 298L170 260L152 211" fill="#111" stroke="#999" />
				{:else}<path d="M90 180L53 249L40 213L25 220L35 282L61 287L111 211M176 184L207 284L174 319L160 303L179 270L151 211" fill="#111" stroke="#999" /><path d="M24 223l-4-35 12-4 11 31z" fill="#ccc" />{/if}
			{:else if character === '白榆'}
				<path d="M82 98L71 64L89 35L112 40L132 23L158 39L181 37L194 73L183 106Z" fill="#151515" stroke="#777" /><path d="M92 80L168 72L178 116L154 149L115 147L92 121Z" fill="#aaa" /><path
					d="M84 78L111 59L115 95L140 67L177 83L178 51L117 38Z"
					fill="#151515"
				/>
				<path d="M110 153L71 175L40 435L104 420L133 472L171 422L229 438L193 176L158 154Z" fill="#252525" stroke="#aaa" /><path
					d="M104 157L116 252L143 186L166 160L177 224L147 199L135 442M91 245L68 384L110 376M179 247L204 384L162 376"
					stroke="#999"
				/><path d="M108 154L137 186L159 154L150 227H123Z" fill="#777" /><path d="M88 425L77 495H117L135 456L156 496H199L178 425" fill="#111" stroke="#666" />
				<path d="M190 236v91h14v-91z" fill="#ddd" />{#each rows as y}<path d={`M193 ${243 + y * 10}h7`} stroke="#333" />{/each}
				{#if pose === 1 || pose === 5}<path d="M78 184L47 248L17 221L6 238L44 285L64 282L107 215M185 184L211 278L161 318L147 300L182 260L161 214" fill="#252525" stroke="#aaa" /><path d="M9 239L0 213L9 205L23 225Z" fill="#aaa" />
				{:else if pose === 3 || pose === 4}<path d="M78 184L56 287L106 320L120 302L83 266L104 215M186 184L216 255L174 207L157 218L192 287L211 283L231 262L209 186" fill="#252525" stroke="#aaa" /><path
						d="M170 210L155 191L142 197L157 220Z"
						fill="#aaa"
					/>
				{:else}<path d="M78 185L47 285L102 310L115 292L76 267L106 212M185 184L217 277L169 310L152 293L185 258L161 211" fill="#252525" stroke="#aaa" />{/if}
				<path d="M91 278L146 288L191 263L203 316L181 324L179 346L152 357L98 343Z" fill="#d4d4d4" stroke="#777" /><path d="M146 289L152 352M102 301L126 310L147 305L170 321L188 307M114 337L136 317" stroke="#555" />
			{:else if character === '岑'}
				<path d="M82 113L71 91L79 53L105 31H158L186 55L190 105L164 139H100Z" fill="#202020" stroke="#888" /><path d="M95 83L165 75L173 122L148 151L119 146L94 119Z" fill="#aaa" /><path
					d="M83 88L103 62L148 72L163 59L180 99L182 53L153 38L103 41Z"
					fill="#202020"
				/><path d="M90 62L153 47" stroke="#ccc" stroke-width="6" />
				<path d="M110 155L67 182L60 294L77 339L70 481H115L139 366L161 482H204L190 332L209 289L198 181L159 155Z" fill="#272727" stroke="#aaa" /><path d="M109 156L125 183H148L163 157L157 225H117Z" fill="#111" /><path
					d="M99 188L92 324H173L169 188M81 332H190"
					stroke="#999"
					stroke-width="4"
				/><path d="M118 233h34v33h-34z" stroke="#aaa" /><path d="M69 479L59 499H117V479M160 479V499H219L203 479" fill="#111" />
				{#if pose === 1 || pose === 5}<path d="M71 186L47 248L79 287L101 269L77 241L107 204M193 185L212 247L249 206L265 221L217 281L193 274L165 207" fill="#444" stroke="#aaa" /><path
						d="M76 282l27 30 13-12-17-34M246 207l7-19 15 6-4 24"
						fill="#aaa"
					/>
				{:else if pose === 2 || pose === 4}<path d="M70 185L39 265L61 285L127 253L118 232L73 251L105 205M195 185L225 264L212 287L147 264L151 243L193 253L164 205" fill="#444" stroke="#aaa" /><path d="M120 233h27l9 14-12 15-21-9z" fill="#aaa" />
				{:else}<path d="M69 184L51 274L67 297L90 288L109 207M196 184L218 274L201 293L179 283L165 207" fill="#444" stroke="#aaa" /><path d="M68 295l-3 42 15 2 11-48M183 288l9 41 17-3-7-36" fill="#aaa" />{/if}
				<path d="M175 317Q218 373 202 405M175 317Q180 373 160 398" stroke="#ccc" /><path d="M202 396l-10 10 3 14 14 2 6-12-6-12M160 391v24m-6-25v8h12v-8" stroke="#ccc" stroke-width="4" />
			{:else}
				<path d="M86 141Q62 121 79 77Q64 37 104 30Q154 12 178 46Q193 63 179 103L178 149Z" fill="#161616" stroke="#888" /><path d="M99 75Q126 65 157 73L168 117L149 145L117 145L96 115Z" fill="#bcbcbc" /><path
					d="M84 79L96 42L120 43L138 62L172 71L163 41L117 29L88 50Z"
					fill="#161616"
				/>
				<path d="M111 152L74 179L60 316L46 471L83 489H192L229 471L206 312L185 178L153 152Z" fill="#1e1e1e" stroke="#999" /><path d="M109 160L102 222H166L157 159M102 222L79 444Q138 459 193 444L166 222Z" fill="#b6b6b6" stroke="#777" /><path
					d="M116 283H154V312H116"
					stroke="#888"
				/><path d="M84 489V500M182 489V500" stroke="#111" stroke-width="28" />
				<g stroke="#333" stroke-width="2"><ellipse cx="111" cy="101" rx="15" ry="11" /><ellipse cx="148" cy="100" rx="15" ry="11" /><path d="M126 100H133M96 98L87 94M163 97L169 93" /></g>
				{#if pose === 1 || pose === 5}<path d="M79 182L55 276L79 293L117 277L109 258L84 267L111 211M180 182L210 266L256 249L251 231L186 239L154 209" fill="#1e1e1e" stroke="#999" /><path d="M250 231l22 3 3 12-22 6z" fill="#bbb" />
				{:else if pose === 2 || pose === 4}<path d="M78 181L55 282L101 302L117 285L85 264L110 211M180 182L208 282L165 302L148 284L179 262L156 209" fill="#1e1e1e" stroke="#999" /><path d="M104 252H163V319H104Z" fill="#ddd" stroke="#555" /><path
						d="M115 267h35m-35 12h35m-35 12h29"
						stroke="#666"
					/>
				{:else}<path d="M77 182L56 286L128 316L137 295L88 267L110 211M180 182L207 285L144 316L134 295L177 268L156 209" fill="#1e1e1e" stroke="#999" /><path d="M129 294l16 1 4 14-18 8-7-11z" fill="#bbb" />{/if}
			{/if}
		</svg>
	{:else if speaker.includes('校订员')}
		<svg class="editor" viewBox="0 0 320 320" fill="none"
			><path d="M40 80V40H80M240 40H280V80M40 240V280H80M240 280H280V240M60 60H260V260H60ZM160 20V100M20 160H100M220 160H300M160 220V300" stroke="#bbb" /><path d="M120 145H200M120 160H184M120 175H200" stroke="#ddd" stroke-width="3" /></svg
		>
	{/if}
	<div class="lower-shade"></div>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		background: #141414;
		isolation: isolate;
	}
	.world {
		width: 100%;
		height: 100%;
		position: absolute;
		inset: 0;
	}
	.atmosphere {
		position: absolute;
		inset: 0;
		background: radial-gradient(ellipse at 50% 37%, transparent 20%, #0004 80%, #0008);
	}
	.portrait {
		position: absolute;
		bottom: -7%;
		right: max(5%, calc((100% - 1200px) / 2));
		width: auto;
		height: 86%;
		max-width: 60%;
		filter: drop-shadow(-16px 10px 15px #0007);
		transform-origin: 50% 80%;
		transition: transform 700ms ease;
	}
	.portrait.reflective {
		transform: rotate(-2deg) translateY(5px);
	}
	.editor {
		position: absolute;
		right: 12%;
		bottom: 20%;
		width: min(33%, 260px);
	}
	.lower-shade {
		position: absolute;
		inset: 45% 0 0;
		background: linear-gradient(transparent, #080808a6);
	}
	.reduced .portrait {
		transition: none;
	}
	@media (max-width: 600px) {
		.portrait {
			right: -3%;
			height: 65%;
			max-width: 67%;
			bottom: 1%;
		}
		.editor {
			right: 6%;
			bottom: 26%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.portrait {
			transition: none;
		}
	}
</style>
