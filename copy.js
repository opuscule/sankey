// Every hand-written string on the page, in one place. Keys are flat and
// dotted; values are HTML. index.html marks each slot with data-copy="key"
// and view.js fills it before anything measures; main.js reads the rest
// through siteCopy(key, vars), which fills {name} placeholders.
//
// Copy is identical in every view -- only layout differs -- so there are
// no per-view variants here. Loaded blocking from <head>; no build step.
window.SITE_COPY = {
	// --- Hero + chapter select (#hero-intro)
	"hero.headline": 'Real World<br />Clim<span>a</span>te Impact<br /><span>A</span>t Scale',
	"hero.subtitle": 'Explore how climate technologies across the TIF &amp; TIGF portfolios are forecast to alter the trajectory of global emissions over the next 15 years.',
	"hero.intro": 'In this first-of-its-kind interactive experience, Capricorn Investment Group presents the global emissions landscape <strong>as it is today</strong> and <strong>how it could evolve</strong> through the scaling of climate technologies across the global economy.',
	"hero.navIntro": 'The following experience is presented in three distinct chapters. Scroll to continue or select a chapter from the navigation bar below at any time.',
	"hero.navNote": 'NOTE TO USERS: This page includes forward-looking, third-party-modeled data regarding hypothetical technology and emissions outcomes. Please review the disclosures in the "<a href="#conclusion">Conclusion</a>" section before relying on the information presented.',
	"hero.about1": 'Centered on the portfolios of the <strong style="color:var(--color-white);">Technology Impact Fund (TIF)</strong> and <strong style="color:var(--color-white);">Technology Impact Growth Fund (TIGF)</strong>, this interactive experience builds upon the pioneering systems modeling work of Dr. Bojana Bajželj, Julian Allwood, and Jonathan Cullen and incorporates updated public data to visualize relationships between economic activities and greenhouse gas emissions at planetary scale.',
	"hero.about2": 'The purpose is to make climate impact more transparent, tangible, and decision-useful: showing where emissions come from, how systems are connected, and where innovation can shift the trajectory.',
	"hero.about3": '<strong>Begin exploring the flows shaping our future.</strong>',

	// --- Chapter titles -- shared by the hero chapter cards and the bottom sticky nav
	"nav.globalEmissions.title": 'Global Emissions Landscape',
	"nav.globalEmissions.blurb": 'Explore how emissions flow through the global economic system.',
	"nav.portfolio.title": 'TIF &amp; TIGF Portfolios',
	"nav.portfolio.blurb": 'See where TIF &amp; TIGF portfolio companies are developing solutions across this system.',
	"nav.technologyImpacts.title": 'Technology Impacts',
	"nav.technologyImpacts.blurb": 'Explore how these solutions could reshape global emissions flows.',
	"nav.siteTitle": 'Real World Climate Impact At Scale',
	"nav.conclusion.title": 'Conclusion',

	// --- Global emissions Sankey narrative (#sankey-narrative). beatN = SCENES in main.js
	"sankey.status.loading": 'Loading data...',
	"sankey.beat1": '<span class="headline-plain">In 2025, global emissions totaled <strong>54 Gt of CO2e</strong>.</span>',
	"sankey.beat2": 'Transitioning to a low-carbon economy requires understanding the origin of these emissions.',
	"sankey.beat3": 'Total emissions can be viewed through seven different lenses.',
	"sankey.beat4": 'These lenses include the <span class="kw kw-final-service">final services</span> provided to us, such as travel and food.',
	"sankey.beat5": 'They also include the economic <span class="kw kw-sector">sectors</span> that provide those final services, the <span class="kw kw-equipment">equipment</span> that comprises each sector, the <span class="kw kw-device">devices</span> that make up equipment, the <span class="kw kw-final-energy">final energy</span> that powers devices, <span class="kw kw-fuel">fuels</span> we use, and the type of greenhouse gas <span class="kw kw-emissions">emissions</span>.',
	"sankey.beat6": 'Each lens is inclusive of all the world&rsquo;s emissions.',
	"sankey.beat7": 'Emissions can be <strong>traced between lenses</strong> as they <strong>flow through the global economy</strong>.',
	"sankey.beat8": 'Each lens can be broken down into nodes, such as <strong>travel</strong> and <strong>food</strong> when looking through the lens of <span class="kw kw-final-service">final services</span>.',
	"sankey.beat9": '<strong>Together, all the nodes for one lens sum to global <span class="kw kw-emissions">emissions</span>.</strong>',
	"sankey.beat10": 'Flows between neighboring nodes show how <strong>emissions are connected across lenses</strong>, with the width of the flow reflecting the magnitude of such connections.<br><br>For example, of the 6 Gt CO2e due to <span class="kw kw-sector">Passenger Transport</span>, 4.4 Gt are due to <span class="kw kw-equipment">cars</span>.',
	"sankey.beat11": '<strong>Select any node</strong> in the visualization to explore its emissions today and see how it connects to the wider system.',
	"sankey.status.clickHint": 'Click a node to isolate direct flows',
	"sankey.status.loadError": 'Could not load Sankey data',
	"sankey.status.noFlows": 'No positive flows found for scenario {scenario}',

	// --- TIF & TIGF portfolio (#tif-tigf-portfolio, #portfolio-themes)
	"portfolioIntro.line1": 'This is our starting point for exploring the investments of the Technology Impact Fund and Technology Impact Growth Fund.',
	"portfolioIntro.line2": 'It&apos;s the landscape of global emissions where we are contributing new solutions to accelerate decarbonization.',
	"themes.lead": 'Consider three themes within the TIF &amp; TIGF portfolios:',
	"themes.finaleLead": 'Together, the technologies in the TIF &amp; TIGF portfolios touch many parts of the global economy.',

	// --- Technology impacts (#technology-impacts). {placeholders} are filled by main.js
	"impactsIntro.line1": "The technologies in TIF &amp; TIGF's portfolio impact the 2040 Global Emissions Landscape by avoiding emissions that would otherwise occur.",
	"impactsIntro.line2": 'Here, we show the largest potential avoided emissions, assuming that the technology scales to its maximum, transforming the market it targets.',
	"impactsWalk.copy1": "Let's take Fervo's enhanced geothermal system (EGS) technology as an example, which <strong>avoids future emissions</strong> by replacing fossil fuel baseload power generation.",
	"impactsWalk.copy3": 'These avoided emissions ripple across the global economy.',
	"impacts.cardPrompt": "<strong>Select any company</strong> in TIF &amp; TIGF's portfolio to see how its technology is forecast to impact the Global Emissions Landscape.",
	"impacts.learnMore": 'Access the detailed forecast',
	"impacts.tab.avoided": 'avoided emissions',
	"impacts.tab.analysis": 'analysis details',
	"impacts.tab.overview": 'company overview',
	"impacts.cardSentence": 'If deployed at a transformative scale, {technology} has the potential to reduce global emissions by {amount} in 2040.',
	"impacts.walkSentence": 'By 2040, emissions are forecasted to be reduced by {amount} through the adoption of {technology} at transformative scale.',
	"impacts.loading": 'loading...',
	"impacts.dataPending": 'data pending',
	"impacts.noNode": 'No mapped node available',

	// --- Closing transition
	"closing.line1": 'Taken together, the technologies across the TIF &amp; TIGF portfolios have the potential to meaningfully reduce the world&rsquo;s emissions trajectory by 2040.',
	"closing.line2": 'The precise outcome will depend on how quickly these technologies scale, where they are deployed, and what they replace.',
	"closing.line3": 'But the direction is clear: thoughtful investment can help turn climate innovation into real-world emissions reductions at global scale.',
	"closing.line4": 'Thank you for joining us. We look forward to continuing that journey with you.',

	// --- Conclusion, methodology & legal. Block keys: one string per <section>, markup intact
	"conclusion.heading": 'Acknowledgements and Citations',
	"methodology.toc.credits": 'Credits',
	"methodology.toc.built": 'How the Emissions Map was Built',
	"methodology.toc.references": 'References',
	"methodology.toc.disclaimers": 'Disclaimers',
	"methodology.toc.importantDisclosures": 'Important Disclosures',
	"methodology.credits": `
		<h3>Credits</h3>
		<p class="acknowledgements-layout__lead">This interactive experience was created by Capricorn Investment Group.</p>
		<p class="acknowledgements-layout__meta">September 2026 &copy; Capricorn Investment Group</p>

		<h4 class="acknowledgements-layout__subhead">Partners</h4>
		<ul class="acknowledgements-layout__partners" aria-label="Project partners">
			<li><span>Management &amp; Narrative</span><strong>Tideline</strong></li>
			<li><span>Research &amp; Data</span><strong>Rho Impact</strong></li>
			<li><span>Design</span><strong>Great Jones Studio</strong></li>
			<li><span>Animation</span><strong>Opuscule</strong></li>
		</ul>
	`,
	"methodology.built": `
		<p>Methodology and full details for the technology-level avoided emissions analyses can be found at <a href="https://koi.eco/real-world-impact-appendix/" target="_blank" rel="noopener">koi.eco/real-world-impact-appendix/</a>.</p>
		<h3>How the Emissions Map was Built</h3>

		<h4>The framework</h4>
		<p>The map is built on the framework published in <a href="https://doi.org/10.1021/es400399h" target="_blank" rel="noopener">Bajželj et al. (2013)</a> and the sources compiled there. That work divides total annual anthropogenic greenhouse gas emissions, including energy, process, and land-use change emissions, into seven views of the same global total. Each is a lens on where those emissions come from: the final service being bought, the economic sector that delivers it, the equipment used, the powered device inside that equipment, the final form of energy, the fuel, and the gas released. Emissions from land follow a parallel chain, from service through sector to land use and land management. Flows connect the nodes in one lens to the nodes in an adjacent lens, showing, for example, how emissions from a sector are connected to particular equipment. The original data was compiled for 2010 from IEA fuel-combustion statistics and EDGAR v4.2, with the allocations between nodes derived by triangulation across industry, government, and academic sources.</p>

		<h4>The 2025 data update</h4>
		<p>The underlying data was updated to a present-day base year as part of this project. Energy emissions, process emissions, and agriculture, forestry and land-use change emissions were all updated from the sources cited below. Two nodes were added to represent computing: digital infrastructure equipment at the equipment level, and computing infrastructure, covering data centers, cryptocurrency, and AI, at the device level. An electric motor flow to cars and buses was added so that the electricity they use resolves to the grid rather than to a combustion engine. How emissions flow between the nodes of adjacent lenses was reviewed throughout rather than carried over: those flows were updated where newer data supported a different allocation, and retained where no better evidence existed. The result is a global total of approximately 54 Gt CO2e.</p>

		<h4>The 2040 projection</h4>
		<p>Projecting the map to 2040 uses the NGFS Phase 5 Scenarios Database under its Current Policies scenario, which carries forward only the climate policy legislated and in force today and assumes no new commitments beyond it. That is an assumption about policy rather than about technology: clean technology continues to be deployed and to improve at the pace current policies support. Sector emissions for 2025 and 2040 were obtained from the average across the three core integrated assessment models: GCAM 6.0, MESSAGEix-GLOBIOM 2.0-M-R12, and REMIND-MAgPIE 3.3-4.8. Each sector was then reduced to a 2025-to-2040 growth factor and applied to the corresponding sector node in the 2025 map. The 2040 map keeps the allocations established for 2025. The projected global total is 56.6 Gt CO2e.</p>

		<h4>Connections across the map</h4>
		<p>The underlying data describes connections between adjacent nodes, one lens to the next. It records how much flows from one node to the next, but not which onward connection any particular incoming flow feeds. The continuous flows shown in the Experience span all seven lenses, by assuming that each flow arriving at a node spreads across the connections leaving it in proportion to their size. Combinations that are not physically sensible, such as demand for illumination entering the residential sector and leaving through a hot water system, are ruled out at the sector lens.</p>
	`,
	"methodology.references": `
		<h3>References</h3>
		<ol class="methodology-content__references">
			<li><strong>Bajželj, B., Allwood, J. M., and Cullen, J. M.</strong> (2013). Designing Climate Change Mitigation Plans That Add Up. <em>Environmental Science &amp; Technology</em> 47(14), 8062&ndash;8069. <a href="https://doi.org/10.1021/es400399h" target="_blank" rel="noopener">doi:10.1021/es400399h</a></li>
			<li><strong>IEA datasets.</strong> <a href="https://www.iea.org/data-and-statistics/data-product/greenhouse-gas-emissions-from-energy-highlights" target="_blank" rel="noopener">GHG Emissions from Energy</a> (2024); <a href="https://www.iea.org/data-and-statistics/data-product/world-energy-statistics-balances" target="_blank" rel="noopener">World Energy Statistics and Balances</a>; World Energy Balances 2019 (<a href="https://doi.org/10.1787/3a876031-en" target="_blank" rel="noopener">doi:10.1787/3a876031-en</a>); CO2 Emissions from Fuel Combustion 2019 (<a href="https://doi.org/10.1787/2a701673-en" target="_blank" rel="noopener">doi:10.1787/2a701673-en</a>)</li>
			<li><strong>IEA reports.</strong> <a href="https://www.iea.org/reports/world-energy-outlook-2024" target="_blank" rel="noopener">World Energy Outlook 2024</a>; <a href="https://www.iea.org/reports/road-transport" target="_blank" rel="noopener">Road Transport 2023</a>; <a href="https://www.iea.org/reports/electricity-2024" target="_blank" rel="noopener">Electricity 2024</a>; <a href="https://www.iea.org/reports/energy-and-ai" target="_blank" rel="noopener">Energy and AI 2025</a></li>
			<li><strong>IEA energy system topic pages and data charts.</strong> <a href="https://www.iea.org/topics" target="_blank" rel="noopener">iea.org/topics</a>, <a href="https://www.iea.org/data-and-statistics/charts" target="_blank" rel="noopener">iea.org/data-and-statistics/charts</a></li>
			<li><a href="https://edgar.jrc.ec.europa.eu/" target="_blank" rel="noopener"><strong>EDGAR</strong></a>, Emissions Database for Global Atmospheric Research, 2024 release. European Commission Joint Research Centre</li>
			<li><a href="https://www.ngfs.net/ngfs-scenarios-portal/" target="_blank" rel="noopener"><strong>NGFS Phase 5 Scenarios Database</strong></a>, Current Policies scenario. GCAM 6.0, MESSAGEix-GLOBIOM 2.0-M-R12, and REMIND-MAgPIE 3.3-4.8, accessed through the <a href="https://data.ece.iiasa.ac.at/ngfs/" target="_blank" rel="noopener">IIASA Scenario Explorer</a></li>
			<li><strong>IPCC</strong> (2021), <a href="https://www.ipcc.ch/report/ar6/wg1/" target="_blank" rel="noopener">Sixth Assessment Report, Working Group I</a>. GWP-100 characterization factors</li>
			<li><strong>FAO, <a href="https://www.fao.org/faostat/en/" target="_blank" rel="noopener">FAOSTAT</a>.</strong> Emissions Totals; Forestry Production and Trade; Food Balances</li>
			<li><strong>UNFCCC</strong>, <a href="https://di.unfccc.int/flex_annex1" target="_blank" rel="noopener">Greenhouse Gas Inventory Database, Annex I</a></li>
			<li><strong>USGS National Minerals Information Center</strong>, <a href="https://www.usgs.gov/centers/national-minerals-information-center/aluminum-statistics-and-information" target="_blank" rel="noopener">Aluminum</a> and <a href="https://www.usgs.gov/centers/national-minerals-information-center/lime-statistics-and-information" target="_blank" rel="noopener">Lime</a> statistics and information</li>
			<li><strong>Pendrill, F. et al.</strong> (2019). Agricultural and forestry trade drives large share of tropical deforestation emissions. <em>Global Environmental Change</em> 56, 1&ndash;10. <a href="https://doi.org/10.1016/j.gloenvcha.2019.03.002" target="_blank" rel="noopener">doi:10.1016/j.gloenvcha.2019.03.002</a></li>
			<li><strong>Friedlingstein, P. et al.</strong> (2025). Global Carbon Budget 2024. <em>Earth System Science Data</em> 17, 965&ndash;1039. <a href="https://doi.org/10.5194/essd-17-965-2025" target="_blank" rel="noopener">doi:10.5194/essd-17-965-2025</a></li>
			<li><strong>Purohit, P. and H&ouml;glund-Isaksson, L.</strong> (2017). Global emissions of fluorinated greenhouse gases 2005&ndash;2050 with abatement potentials and costs. <em>Atmospheric Chemistry and Physics</em> 17, 2795&ndash;2816. <a href="https://doi.org/10.5194/acp-17-2795-2017" target="_blank" rel="noopener">doi:10.5194/acp-17-2795-2017</a></li>
			<li><strong>International Fertilizer Association</strong> (2022). <a href="https://ifastat.org/fertilizer-reports-analysis/fertilizer-use-by-crop-fubc" target="_blank" rel="noopener">Fertilizer Use by Crop and Country</a> for the 2017&ndash;2018 period</li>
			<li><strong>European Solvents Industry Group</strong> (2017). <a href="https://www.esig.org/wp-content/uploads/2020/01/ESIG-advocacy-document-triptic_WEB.pdf" target="_blank" rel="noopener">Solvents and ESIG</a></li>
			<li><strong>US Department of Transportation, Federal Highway Administration.</strong> <a href="https://nhts.ornl.gov/" target="_blank" rel="noopener">National Household Travel Survey</a>, 2022</li>
			<li><strong>Eurostat</strong>, <a href="https://ec.europa.eu/eurostat/web/main/data/database" target="_blank" rel="noopener">Air Transport Performance</a>.</li>
		</ol>
	`,
	"methodology.disclaimers": `
		<h3>Disclaimers</h3>

		<h4>About the Data and Modeling</h4>
		<p>The underlying emissions data, avoided-emissions estimates, and 2040 projections were developed using Koi, a forecasting platform built by Rho Impact, drawing on the systems modeling work of Bojana Bajželj, Julian Allwood, and Jonathan Cullen and incorporating updated public data sources. This information was provided to Capricorn Investment Group, LLC (&ldquo;Capricorn&rdquo;) by Rho Impact, and Capricorn has not independently verified, audited, or otherwise validated the accuracy, completeness, or methodology of the underlying data or modeling. Capricorn relies on Rho Impact as the source for this information and disclaims responsibility for any errors, omissions, or inaccuracies contained in it.</p>
		<p>Detailed model inputs, baseline assumptions, and sources for each technology referenced above are available in the accompanying Appendix, built on Koi, Rho Impact&rsquo;s forecasting platform. The same reliance and no-independent verification disclosures set out above apply to that appendix.</p>
		<p>Estimates of avoided emissions associated with portfolio companies in the Technology Impact Fund and Technology Impact Growth Fund are hypothetical and forward-looking. They assume that a given technology scales to its maximum potential and displaces a specific incumbent technology or process; actual outcomes will depend on the pace and location of deployment and may differ materially from what is shown. These estimates do not represent audited results, are not a measure of realized fund performance, and should not be relied on as such.</p>
		<p>This experience is provided for informational and illustrative purposes only. It does not constitute investment advice, a recommendation, or an offer to buy or sell any security or fund interest. Prospective and current investors should refer to the applicable fund&rsquo;s offering documents for complete information regarding the Technology Impact Fund and Technology Impact Growth Fund.</p>

		<h4>About the Appendix</h4>
		<p>The technology models in the Appendix were built and are maintained on Koi, a climate-impact forecasting platform developed by Rho Impact, an independent third party. Koi&rsquo;s own validation process, referenced here as &ldquo;fully validated,&rdquo; reflects Rho Impact&rsquo;s internal model review and does not constitute independent verification by Capricorn Investment Group, LLC (&ldquo;Capricorn&rdquo;). Capricorn has not audited the baseline assumptions, solution intensities, market-sizing inputs, or source data underlying these models and relies on Rho Impact for their accuracy and completeness.</p>
		<p>The portfolio companies referenced in this Appendix have not reviewed, validated, or endorsed the models, assumptions, or figures attributed to them. Mapping a company to a model reflects Rho Impact&rsquo;s assessment that the company&rsquo;s technology falls within that model&rsquo;s scope; it does not reflect the company&rsquo;s own estimate of its emissions impact, and the company has not confirmed the accuracy of the baseline, solution, or market assumptions used. Company names and logos are used for identification purposes only and do not imply the company&rsquo;s participation in, agreement with, or endorsement of this analysis.</p>
		<p>Estimated emissions displacement is modeled at the technology level using assumptions about addressable market size, market capture, and per-unit displacement, rather than company-specific operational data. A company is mapped to a model because its technology falls within that model&rsquo;s scope, not because Rho Impact or Capricorn has forecast that specific outcome for that company. Actual outcomes will depend on regulatory pathways, deployment timelines, capital availability, competitive dynamics, and other factors, and may differ materially from these estimates.</p>
		<p>The Appendix is provided for informational purposes only, does not constitute investment advice or a recommendation, and should be read together with the Disclosures related to the Sankey visualization.</p>
	`,
	"methodology.importantDisclosures": `
		<h3>Important Disclosures</h3>
		<p>Capricorn Investment Group, LLC (&ldquo;Capricorn&rdquo;) is registered as an investment adviser with the U.S. Securities and Exchange Commission (&ldquo;SEC&rdquo;). Registration does not imply any level of skill or training and does not constitute an endorsement of the firm by the SEC. Nothing on this page constitutes an offer to sell, or a solicitation of an offer to buy, any security or interest in any fund, including the Technology Impact Fund or the Technology Impact Growth Fund. Any such offer or solicitation will be made only through the applicable fund&rsquo;s limited partnership agreement and other governing documents to qualified investors, and only in jurisdictions where permitted by law.</p>
		<p>This page references specific portfolio companies for illustrative purposes. This is not a complete list of the fund&rsquo;s investments, and it should not be assumed that any investment identified was or will be profitable, or that the technologies referenced will achieve the emissions reductions modeled. The referenced companies have not reviewed, validated, or endorsed the figures or models attributed to them, and their inclusion does not imply their participation in or agreement with this analysis. A complete list of the funds&rsquo; investments is available upon request.</p>
		<p>Statements regarding future emissions, technology adoption, market scale, or climate outcomes are forward-looking and reflect assumptions as of September 2026 that are subject to significant uncertainty. Actual results may differ materially. Past or projected environmental impact is not indicative of future financial performance. For more information about Capricorn&rsquo;s advisory business, services, and fees, please refer to our Form ADV and Form CRS available <a href="https://adviserinfo.sec.gov/firm/summary/147417" target="_blank" rel="noopener">here</a> or upon request.</p>
		<p>Company and product names, logos, and trademarks referenced herein are the property of their respective owners. Their use does not imply endorsement of, or affiliation with, Capricorn beyond the investment relationship described. The information, data, and projections presented reflect assumptions and inputs as of September 2026 and are subject to change without notice. Capricorn undertakes no obligation to update this content to reflect subsequent events or developments.</p>
	`,

	// --- Floating tooltip
	"tooltip.techImpacts": 'The Conclusion section includes more information on the forecasting approach and related disclosures.'
};
