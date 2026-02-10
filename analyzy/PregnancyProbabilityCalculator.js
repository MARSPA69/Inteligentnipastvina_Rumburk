/**
 * ============================================================================
 * PREGNANCY PROBABILITY CALCULATOR FOR CATTLE
 * ============================================================================
 * 
 * Algoritmus pro výpočet pravděpodobnosti březosti krávy na základě:
 * - Datum posledního porodu
 * - Datum, do kdy byla kráva s býkem
 * - Volitelně: datum analýzy (default = dnes)
 * 
 * Autor: Cattle Monitoring System v2.0
 * ============================================================================
 */

const PregnancyCalculator = (function() {
    'use strict';

    // =========================================================================
    // BIOLOGICKÉ KONSTANTY
    // =========================================================================
    
    const CONFIG = {
        // Post-partum období
        POSTPARTUM_RECOVERY_DAYS: 45,          // Minimální doba zotavení po porodu
        POSTPARTUM_OPTIMAL_START: 60,          // Optimální začátek pro koncepci
        
        // Estrus (říje) cyklus
        ESTRUS_CYCLE_DAYS: 21,                 // Průměrná délka cyklu
        ESTRUS_CYCLE_MIN: 18,                  // Minimální délka cyklu
        ESTRUS_CYCLE_MAX: 24,                  // Maximální délka cyklu
        ESTRUS_DURATION_HOURS: 18,             // Průměrná délka estru (12-24h)
        
        // Koncepce - úspěšnost
        CONCEPTION_RATE_FIRST_ESTRUS: 0.35,    // Úspěšnost při 1. estru po porodu (nižší)
        CONCEPTION_RATE_SECOND_ESTRUS: 0.50,   // Úspěšnost při 2. estru
        CONCEPTION_RATE_NORMAL: 0.55,          // Normální úspěšnost (3+ estrus)
        CONCEPTION_RATE_OPTIMAL: 0.60,         // Optimální podmínky
        
        // Gestace
        GESTATION_DAYS: 283,                   // Průměrná délka březosti
        GESTATION_MIN: 275,                    // Minimální délka
        GESTATION_MAX: 290,                    // Maximální délka
        
        // Trimestry
        TRIMESTER_1_END: 94,                   // Konec 1. trimestru (den)
        TRIMESTER_2_END: 188,                  // Konec 2. trimestru (den)
        
        // Detekce estru
        ESTRUS_DETECTION_RATE: 0.85,           // Pravděpodobnost, že estrus nastane v očekávaném okně
        SILENT_HEAT_RATE: 0.15,                // Pravděpodobnost "tichého" estru (bez viditelných příznaků)
        
        // Časové faktory
        BULL_SERVICE_SUCCESS: 0.95,            // Pravděpodobnost, že býk pokryje krávu během estru
        SEASONAL_FACTOR_SUMMER: 1.0,           // Letní období (červen-srpen)
        SEASONAL_FACTOR_AUTUMN: 1.05,          // Podzim (září-listopad) - mírně lepší
        SEASONAL_FACTOR_WINTER: 0.90,          // Zima (prosinec-únor) - horší
        SEASONAL_FACTOR_SPRING: 0.95,          // Jaro (březen-květen)
    };

    // =========================================================================
    // POMOCNÉ FUNKCE
    // =========================================================================

    /**
     * Parsování data z různých formátů
     */
    function parseDate(dateInput) {
        if (!dateInput) return null;
        
        if (dateInput instanceof Date) {
            return new Date(dateInput.getTime());
        }
        
        // ISO formát: 2025-08-15
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
            return new Date(dateInput + 'T00:00:00');
        }
        
        // Český formát: 15.8.2025 nebo 15.08.2025
        const czMatch = dateInput.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (czMatch) {
            const [, day, month, year] = czMatch;
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        }
        
        // Formát dd/mm/yyyy
        const slashMatch = dateInput.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (slashMatch) {
            const [, day, month, year] = slashMatch;
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        }
        
        // Zkusit nativní parsování
        const parsed = new Date(dateInput);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    /**
     * Formátování data do českého formátu
     */
    function formatDateCZ(date) {
        if (!date) return '-';
        const d = new Date(date);
        return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
    }

    /**
     * Formátování data do ISO formátu
     */
    function formatDateISO(date) {
        if (!date) return null;
        const d = new Date(date);
        return d.toISOString().split('T')[0];
    }

    /**
     * Počet dní mezi dvěma daty
     */
    function daysBetween(date1, date2) {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        const diffTime = d2.getTime() - d1.getTime();
        return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * Přidání dnů k datu
     */
    function addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }

    /**
     * Získání sezónního faktoru pro dané datum
     */
    function getSeasonalFactor(date) {
        const month = new Date(date).getMonth(); // 0-11
        
        if (month >= 5 && month <= 7) return CONFIG.SEASONAL_FACTOR_SUMMER;      // Červen-Srpen
        if (month >= 8 && month <= 10) return CONFIG.SEASONAL_FACTOR_AUTUMN;     // Září-Listopad
        if (month === 11 || month <= 1) return CONFIG.SEASONAL_FACTOR_WINTER;    // Prosinec-Únor
        return CONFIG.SEASONAL_FACTOR_SPRING;                                      // Březen-Květen
    }

    /**
     * Získání úspěšnosti koncepce pro daný estrus cyklus
     */
    function getConceptionRate(estrusNumber, date) {
        let baseRate;
        
        if (estrusNumber === 1) {
            baseRate = CONFIG.CONCEPTION_RATE_FIRST_ESTRUS;
        } else if (estrusNumber === 2) {
            baseRate = CONFIG.CONCEPTION_RATE_SECOND_ESTRUS;
        } else if (estrusNumber >= 3) {
            baseRate = CONFIG.CONCEPTION_RATE_NORMAL;
        } else {
            baseRate = CONFIG.CONCEPTION_RATE_NORMAL;
        }
        
        // Aplikovat sezónní faktor
        const seasonalFactor = getSeasonalFactor(date);
        
        // Aplikovat úspěšnost býka
        const adjustedRate = baseRate * seasonalFactor * CONFIG.BULL_SERVICE_SUCCESS;
        
        return Math.min(adjustedRate, CONFIG.CONCEPTION_RATE_OPTIMAL);
    }

    // =========================================================================
    // HLAVNÍ VÝPOČETNÍ FUNKCE
    // =========================================================================

    /**
     * Výpočet všech možných estrus cyklů v fertilním okně
     * @returns {Array} Seznam estrus cyklů s pravděpodobnostmi
     */
    function calculateEstrusCycles(calvingDate, bullEndDate) {
        const calving = parseDate(calvingDate);
        const bullEnd = parseDate(bullEndDate);
        
        if (!calving || !bullEnd) {
            throw new Error('Neplatné datum porodu nebo datum odchodu býka');
        }
        
        // První fertilní den (po post-partum zotavení)
        const firstFertileDate = addDays(calving, CONFIG.POSTPARTUM_RECOVERY_DAYS);
        
        // Pokud býk odešel před fertilním oknem
        if (bullEnd < firstFertileDate) {
            return {
                cycles: [],
                fertileDays: 0,
                fertileWindowStart: firstFertileDate,
                fertileWindowEnd: bullEnd,
                noFertileWindow: true
            };
        }
        
        // Délka fertilního okna
        const fertileDays = daysBetween(firstFertileDate, bullEnd) + 1;
        
        // Výpočet estrus cyklů
        const cycles = [];
        let currentDate = new Date(firstFertileDate);
        let cycleNumber = 1;
        
        // První estrus - může nastat kdykoliv v prvních 21 dnech od fertility
        // Používáme průměr, že první estrus nastane kolem dne 10-14 po začátku fertility
        let firstEstrusOffset = Math.floor(CONFIG.ESTRUS_CYCLE_DAYS / 2);
        let estrusDate = addDays(firstFertileDate, firstEstrusOffset);
        
        // Pokud by první estrus byl před fertilním oknem, posunout na začátek
        if (estrusDate < firstFertileDate) {
            estrusDate = new Date(firstFertileDate);
        }
        
        while (estrusDate <= bullEnd) {
            const conceptionRate = getConceptionRate(cycleNumber, estrusDate);
            const seasonalFactor = getSeasonalFactor(estrusDate);
            
            cycles.push({
                cycleNumber,
                estrusDate: new Date(estrusDate),
                estrusDateFormatted: formatDateCZ(estrusDate),
                daysPostPartum: daysBetween(calving, estrusDate),
                conceptionRate,
                seasonalFactor,
                expectedDueDate: addDays(estrusDate, CONFIG.GESTATION_DAYS),
                expectedDueDateFormatted: formatDateCZ(addDays(estrusDate, CONFIG.GESTATION_DAYS))
            });
            
            // Další estrus za 21 dní
            estrusDate = addDays(estrusDate, CONFIG.ESTRUS_CYCLE_DAYS);
            cycleNumber++;
        }
        
        return {
            cycles,
            fertileDays,
            fertileWindowStart: firstFertileDate,
            fertileWindowEnd: bullEnd,
            noFertileWindow: false
        };
    }

    /**
     * Výpočet kumulativní pravděpodobnosti březosti
     * 
     * Používá vzorec: P(březí) = 1 - Π(1 - P_i)
     * Kde P_i je pravděpodobnost koncepce v i-tém cyklu
     */
    function calculateCumulativeProbability(cycles) {
        if (!cycles || cycles.length === 0) {
            return {
                probability: 0,
                probabilityPercent: 0,
                cycleDetails: [],
                mostLikelyConceptionCycle: null
            };
        }
        
        // Pravděpodobnost, že kráva NENÍ březí po všech cyklech
        let probNotPregnant = 1.0;
        const cycleDetails = [];
        
        for (let i = 0; i < cycles.length; i++) {
            const cycle = cycles[i];
            const pConception = cycle.conceptionRate;
            
            // Pravděpodobnost koncepce v tomto cyklu (pokud nebyla březí dříve)
            const pConceptionThisCycle = probNotPregnant * pConception;
            
            cycleDetails.push({
                ...cycle,
                cumulativeProbNotPregnant: probNotPregnant,
                probabilityThisCycle: pConceptionThisCycle,
                probabilityThisCyclePercent: (pConceptionThisCycle * 100).toFixed(1)
            });
            
            // Aktualizovat pravděpodobnost, že není březí
            probNotPregnant *= (1 - pConception);
        }
        
        const probability = 1 - probNotPregnant;
        
        // Najít nejpravděpodobnější cyklus koncepce (vážený průměr)
        let weightedSum = 0;
        let weightSum = 0;
        
        for (const detail of cycleDetails) {
            weightedSum += detail.cycleNumber * detail.probabilityThisCycle;
            weightSum += detail.probabilityThisCycle;
        }
        
        const avgCycleIndex = weightSum > 0 ? Math.round(weightedSum / weightSum) - 1 : 0;
        const mostLikelyCycle = cycleDetails[Math.min(avgCycleIndex, cycleDetails.length - 1)];
        
        return {
            probability,
            probabilityPercent: (probability * 100).toFixed(1),
            cycleDetails,
            mostLikelyConceptionCycle: mostLikelyCycle
        };
    }

    /**
     * Výpočet informací o březosti k danému datu analýzy
     */
    function calculatePregnancyStatus(calvingDate, bullEndDate, analysisDate = new Date()) {
        const calving = parseDate(calvingDate);
        const bullEnd = parseDate(bullEndDate);
        const analysis = parseDate(analysisDate);
        
        if (!calving || !bullEnd) {
            return { error: 'Neplatné vstupní datum' };
        }
        
        // Základní výpočty
        const estrusCyclesData = calculateEstrusCycles(calvingDate, bullEndDate);
        
        if (estrusCyclesData.noFertileWindow) {
            return {
                status: 'no_fertile_window',
                statusText: 'Bez fertilního okna',
                statusDescription: 'Býk odešel před koncem post-partum zotavení',
                probability: 0,
                probabilityPercent: '0.0',
                calvingDate: formatDateCZ(calving),
                bullEndDate: formatDateCZ(bullEnd),
                analysisDate: formatDateCZ(analysis),
                postPartumRecoveryEnd: formatDateCZ(addDays(calving, CONFIG.POSTPARTUM_RECOVERY_DAYS)),
                fertileDays: 0,
                possibleCycles: 0,
                cycles: []
            };
        }
        
        const probabilityData = calculateCumulativeProbability(estrusCyclesData.cycles);
        
        // Určit aktuální stav březosti
        const daysSinceCalving = daysBetween(calving, analysis);
        let gestationDay = null;
        let trimester = null;
        let expectedDueDate = null;
        let daysToParturition = null;
        
        if (probabilityData.mostLikelyConceptionCycle) {
            const conceptionDate = probabilityData.mostLikelyConceptionCycle.estrusDate;
            gestationDay = daysBetween(conceptionDate, analysis);
            
            if (gestationDay > 0 && gestationDay <= CONFIG.GESTATION_DAYS) {
                expectedDueDate = addDays(conceptionDate, CONFIG.GESTATION_DAYS);
                daysToParturition = daysBetween(analysis, expectedDueDate);
                
                if (gestationDay <= CONFIG.TRIMESTER_1_END) {
                    trimester = 1;
                } else if (gestationDay <= CONFIG.TRIMESTER_2_END) {
                    trimester = 2;
                } else {
                    trimester = 3;
                }
            }
        }
        
        // Určit status
        let status, statusText, statusDescription;
        const prob = probabilityData.probability;
        
        if (prob >= 0.7) {
            status = 'likely_pregnant';
            statusText = 'Pravděpodobně březí';
            statusDescription = `Vysoká pravděpodobnost březosti (${probabilityData.probabilityPercent}%)`;
        } else if (prob >= 0.4) {
            status = 'possibly_pregnant';
            statusText = 'Možná březí';
            statusDescription = `Střední pravděpodobnost březosti (${probabilityData.probabilityPercent}%)`;
        } else if (prob >= 0.15) {
            status = 'uncertain';
            statusText = 'Nejisté';
            statusDescription = `Nízká pravděpodobnost březosti (${probabilityData.probabilityPercent}%)`;
        } else {
            status = 'unlikely_pregnant';
            statusText = 'Pravděpodobně nebřezí';
            statusDescription = `Velmi nízká pravděpodobnost březosti (${probabilityData.probabilityPercent}%)`;
        }
        
        // Výpočet rozsahu očekávaného porodu
        let dueDateRange = null;
        if (estrusCyclesData.cycles.length > 0) {
            const firstCycle = estrusCyclesData.cycles[0];
            const lastCycle = estrusCyclesData.cycles[estrusCyclesData.cycles.length - 1];
            dueDateRange = {
                earliest: firstCycle.expectedDueDate,
                earliestFormatted: firstCycle.expectedDueDateFormatted,
                latest: lastCycle.expectedDueDate,
                latestFormatted: lastCycle.expectedDueDateFormatted
            };
        }
        
        return {
            // Základní status
            status,
            statusText,
            statusDescription,
            
            // Pravděpodobnost
            probability: probabilityData.probability,
            probabilityPercent: probabilityData.probabilityPercent,
            
            // Vstupní data
            calvingDate: formatDateCZ(calving),
            calvingDateISO: formatDateISO(calving),
            bullEndDate: formatDateCZ(bullEnd),
            bullEndDateISO: formatDateISO(bullEnd),
            analysisDate: formatDateCZ(analysis),
            analysisDateISO: formatDateISO(analysis),
            
            // Časové údaje
            daysSinceCalving,
            postPartumRecoveryEnd: formatDateCZ(addDays(calving, CONFIG.POSTPARTUM_RECOVERY_DAYS)),
            fertileWindowStart: formatDateCZ(estrusCyclesData.fertileWindowStart),
            fertileWindowEnd: formatDateCZ(estrusCyclesData.fertileWindowEnd),
            fertileDays: estrusCyclesData.fertileDays,
            
            // Estrus cykly
            possibleCycles: estrusCyclesData.cycles.length,
            cycles: probabilityData.cycleDetails,
            mostLikelyConceptionCycle: probabilityData.mostLikelyConceptionCycle,
            
            // Pokud březí
            gestationDay,
            trimester,
            trimesterText: trimester ? `${trimester}. trimestr` : null,
            expectedDueDate: expectedDueDate ? formatDateCZ(expectedDueDate) : null,
            expectedDueDateISO: expectedDueDate ? formatDateISO(expectedDueDate) : null,
            daysToParturition,
            dueDateRange,
            
            // Pre-porodní alert
            preParturitionAlert: daysToParturition !== null && daysToParturition <= 14 && daysToParturition >= 0,
            
            // Doporučení
            recommendations: generateRecommendations(prob, gestationDay, daysToParturition, analysis)
        };
    }

    /**
     * Generování doporučení na základě stavu
     */
    function generateRecommendations(probability, gestationDay, daysToParturition, analysisDate) {
        const recommendations = [];
        
        if (probability < 0.15) {
            recommendations.push({
                priority: 'info',
                text: 'Velmi nízká pravděpodobnost březosti. Zvažte plán pro další připuštění.'
            });
        } else if (probability < 0.4) {
            recommendations.push({
                priority: 'medium',
                text: 'Doporučena veterinární kontrola pro potvrzení/vyloučení březosti.'
            });
        } else if (probability >= 0.4 && probability < 0.7) {
            recommendations.push({
                priority: 'medium',
                text: 'Střední pravděpodobnost březosti. Doporučen ultrazvuk nebo rektální vyšetření.'
            });
        } else {
            recommendations.push({
                priority: 'high',
                text: 'Vysoká pravděpodobnost březosti. Doporučena konfirmační veterinární kontrola.'
            });
        }
        
        if (gestationDay !== null) {
            if (gestationDay >= 28 && gestationDay <= 35) {
                recommendations.push({
                    priority: 'high',
                    text: 'Ideální období pro ultrazvukové vyšetření (28-35 dnů březosti).'
                });
            } else if (gestationDay >= 35 && gestationDay <= 60) {
                recommendations.push({
                    priority: 'medium',
                    text: 'Stále vhodné období pro rektální vyšetření nebo ultrazvuk.'
                });
            }
        }
        
        if (daysToParturition !== null && daysToParturition <= 30 && daysToParturition > 14) {
            recommendations.push({
                priority: 'high',
                text: 'Blíží se porod. Připravte porodní box a sledujte pre-porodní chování.'
            });
        } else if (daysToParturition !== null && daysToParturition <= 14) {
            recommendations.push({
                priority: 'urgent',
                text: '⚠️ POROD DO 14 DNÍ! Intenzivní monitoring, izolace od stáda, porodní asistence v pohotovosti.'
            });
        }
        
        return recommendations;
    }

    /**
     * Vygenerování textové zprávy pro uživatele
     */
    function generateReport(result) {
        if (result.error) {
            return `Chyba: ${result.error}`;
        }
        
        let report = [];
        
        report.push('═══════════════════════════════════════════════════════════════');
        report.push('              VÝPOČET PRAVDĚPODOBNOSTI BŘEZOSTI                 ');
        report.push('═══════════════════════════════════════════════════════════════');
        report.push('');
        
        report.push('📅 VSTUPNÍ DATA');
        report.push('───────────────────────────────────────────────────────────────');
        report.push(`   Datum posledního porodu:    ${result.calvingDate}`);
        report.push(`   Býk přítomen do:            ${result.bullEndDate}`);
        report.push(`   Datum analýzy:              ${result.analysisDate}`);
        report.push(`   Dnů od porodu:              ${result.daysSinceCalving}`);
        report.push('');
        
        report.push('🔬 FERTILNÍ OKNO');
        report.push('───────────────────────────────────────────────────────────────');
        report.push(`   Post-partum zotavení do:    ${result.postPartumRecoveryEnd} (45 dnů)`);
        report.push(`   Fertilní od:                ${result.fertileWindowStart}`);
        report.push(`   Fertilní do:                ${result.fertileWindowEnd}`);
        report.push(`   Délka fertilního okna:      ${result.fertileDays} dnů`);
        report.push(`   Možných estrus cyklů:       ${result.possibleCycles}`);
        report.push('');
        
        report.push('📊 PRAVDĚPODOBNOST BŘEZOSTI');
        report.push('───────────────────────────────────────────────────────────────');
        report.push(`   Status:                     ${result.statusText}`);
        report.push(`   Pravděpodobnost:            ${result.probabilityPercent}%`);
        report.push(`   ${result.statusDescription}`);
        report.push('');
        
        if (result.cycles && result.cycles.length > 0) {
            report.push('🔄 DETAIL ESTRUS CYKLŮ');
            report.push('───────────────────────────────────────────────────────────────');
            for (const cycle of result.cycles) {
                report.push(`   Cyklus ${cycle.cycleNumber}: ${cycle.estrusDateFormatted}`);
                report.push(`      - Den post-partum: ${cycle.daysPostPartum}`);
                report.push(`      - Úspěšnost koncepce: ${(cycle.conceptionRate * 100).toFixed(0)}%`);
                report.push(`      - Pravděpodobnost v tomto cyklu: ${cycle.probabilityThisCyclePercent}%`);
                report.push(`      - Očekávaný porod: ${cycle.expectedDueDateFormatted}`);
            }
            report.push('');
        }
        
        if (result.mostLikelyConceptionCycle) {
            report.push('🤰 POKUD JE BŘEZÍ (nejpravděpodobnější scénář)');
            report.push('───────────────────────────────────────────────────────────────');
            report.push(`   Pravděpodobná koncepce:     ${result.mostLikelyConceptionCycle.estrusDateFormatted}`);
            report.push(`   Den březosti:               ${result.gestationDay}`);
            report.push(`   Trimestr:                   ${result.trimesterText || '-'}`);
            report.push(`   Očekávaný porod:            ${result.expectedDueDate || '-'}`);
            report.push(`   Dnů do porodu:              ${result.daysToParturition || '-'}`);
            
            if (result.dueDateRange) {
                report.push(`   Rozsah porodu:              ${result.dueDateRange.earliestFormatted} - ${result.dueDateRange.latestFormatted}`);
            }
            report.push('');
        }
        
        if (result.recommendations && result.recommendations.length > 0) {
            report.push('💡 DOPORUČENÍ');
            report.push('───────────────────────────────────────────────────────────────');
            for (const rec of result.recommendations) {
                const icon = rec.priority === 'urgent' ? '🚨' : 
                            rec.priority === 'high' ? '❗' : 
                            rec.priority === 'medium' ? '📌' : 'ℹ️';
                report.push(`   ${icon} ${rec.text}`);
            }
            report.push('');
        }
        
        if (result.preParturitionAlert) {
            report.push('');
            report.push('🚨🚨🚨 VAROVÁNÍ: BLÍŽÍ SE POROD! 🚨🚨🚨');
            report.push('   Sledujte pre-porodní chování:');
            report.push('   - Izolace od stáda');
            report.push('   - Zóny stání > 3 minuty');
            report.push('   - Nervozita, neklid');
            report.push('   - Změny v příjmu potravy');
        }
        
        report.push('');
        report.push('═══════════════════════════════════════════════════════════════');
        
        return report.join('\n');
    }

    // =========================================================================
    // VEŘEJNÉ API
    // =========================================================================

    return {
        /**
         * Hlavní funkce pro výpočet pravděpodobnosti březosti
         * 
         * @param {string|Date} calvingDate - Datum posledního porodu
         * @param {string|Date} bullEndDate - Datum, do kdy byla kráva s býkem
         * @param {string|Date} [analysisDate] - Datum analýzy (default = dnes)
         * @returns {Object} Kompletní výsledek analýzy
         * 
         * @example
         * const result = PregnancyCalculator.calculate('15.8.2025', '30.11.2025', '21.12.2025');
         * console.log(result.probabilityPercent); // "78.5"
         */
        calculate: calculatePregnancyStatus,
        
        /**
         * Generování textové zprávy
         */
        generateReport: function(calvingDate, bullEndDate, analysisDate) {
            const result = calculatePregnancyStatus(calvingDate, bullEndDate, analysisDate);
            return generateReport(result);
        },
        
        /**
         * Získání pouze pravděpodobnosti (pro rychlé použití)
         */
        getProbability: function(calvingDate, bullEndDate, analysisDate) {
            const result = calculatePregnancyStatus(calvingDate, bullEndDate, analysisDate);
            return {
                probability: result.probability,
                percent: result.probabilityPercent,
                status: result.status
            };
        },
        
        /**
         * Výpočet estrus cyklů (pro debug/vizualizaci)
         */
        getEstrusCycles: calculateEstrusCycles,
        
        /**
         * Konfigurace
         */
        CONFIG: CONFIG,
        
        /**
         * Verze
         */
        VERSION: '2.0.0'
    };

})();

// Export pro Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PregnancyCalculator;
}

// =========================================================================
// PŘÍKLAD POUŽITÍ A TEST
// =========================================================================

// Pokud spuštěno přímo (ne jako modul)
if (typeof window !== 'undefined') {
    window.PregnancyCalculator = PregnancyCalculator;
    
    // Demo výpočet
    console.log('=== Pregnancy Calculator Demo ===');
    
    const testResult = PregnancyCalculator.calculate('15.8.2025', '30.11.2025', '21.12.2025');
    console.log('Result:', testResult);
    console.log('\n' + PregnancyCalculator.generateReport('15.8.2025', '30.11.2025', '21.12.2025'));
}
