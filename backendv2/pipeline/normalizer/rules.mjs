// Deterministic Normalization Rules

// 1. UOM NORMALIZATION
const uomAliases = {
    // Length / Distance
    'in': ['in', 'in.', 'inch', 'inches', '"', '-in', 'in '],
    'ft': ['ft', 'ft.', 'foot', 'feet', "'"],
    'yd': ['yd', 'yd.', 'yard', 'yards'],
    'mm': ['mm', 'mm.', 'millimeter', 'millimeters'],
    'cm': ['cm', 'cm.', 'centimeter', 'centimeters'],
    'm': ['m', 'm.', 'meter', 'meters'],
    // Weight
    'lb': ['lb', 'lb.', 'lbs', 'lbs.', 'pound', 'pounds'],
    'oz': ['oz', 'oz.', 'ounce', 'ounces'],
    'kg': ['kg', 'kg.', 'kilo', 'kilogram', 'kilograms'],
    'g': ['g', 'g.', 'gram', 'grams'],
    // Electrical
    'V': ['v', 'v.', 'volt', 'volts', 'vac', 'vdc'],
    'A': ['a', 'a.', 'amp', 'amps', 'ampere', 'amperes'],
    'Hz': ['hz', 'hertz'],
    'W': ['w', 'w.', 'watt', 'watts'],
    'kW': ['kw', 'kilowatt', 'kilowatts'],
    // Rotation
    'rpm': ['rpm', 'rpms', 'rev/min', 'revolutions per minute'],
    // Quantity
    'pc': ['pc', 'pc.', 'pcs', 'pcs.', 'piece', 'pieces'],
    'pk': ['pk', 'pk.', 'pack', 'packs'],
    'ea': ['ea', 'ea.', 'each']
};

const buildUomRegex = () => {
    const regexMap = {};
    for (const [canonical, aliases] of Object.entries(uomAliases)) {
        // Escape special chars like " or ' or .
        const escapedAliases = aliases.map(a => a.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
        // Build regex that matches number + optional space + alias
        regexMap[canonical] = new RegExp(`^([0-9]+(?:\\.[0-9]+)?)\\s*(${escapedAliases.join('|')})$`, 'i');
    }
    return regexMap;
};
const uomRegexMap = buildUomRegex();

// 2. DECIMAL TO FRACTION CONVERSION
// Only safe exact conversions
const fractionLookup = {
    '0.5': '1/2',
    '0.25': '1/4',
    '0.75': '3/4',
    '0.125': '1/8',
    '0.375': '3/8',
    '0.625': '5/8',
    '0.875': '7/8',
    '0.0625': '1/16',
    '0.1875': '3/16',
    '0.3125': '5/16',
    '0.4375': '7/16',
    '0.5625': '9/16',
    '0.6875': '11/16',
    '0.8125': '13/16',
    '0.9375': '15/16'
};

// 3. BOOLEAN NORMALIZATION
const booleanTrue = new Set(['y', 'yes', 'true', 'included', '1', 't']);
const booleanFalse = new Set(['n', 'no', 'false', 'not included', 'none', '0', 'f']);

const booleanAttributes = new Set([
    'vacuum support',
    'assorted pack',
    'includes case',
    'cordless',
    'brushless'
]);

// 4. BRAND CANONICALIZATION (Deterministic only)
const brandAliases = {
    '3m': '3M',
    'dewalt': 'DEWALT',
    'milwaukee': 'Milwaukee',
    'makita': 'Makita',
    'bosch': 'Bosch',
    'festool': 'Festool',
    'stanley': 'Stanley',
    'crescent': 'Crescent',
    'diablo': 'Diablo'
};

// 5. CASING NORMALIZATION
const titleCaseAttributes = new Set([
    'coat type',
    'backing material',
    'abrasive material',
    'bond type',
    'product form'
]); // Removed attachment type to avoid breaking acronyms like PSA


const dimensionalAttributes = new Set([
    'width', 'length', 'height', 'diameter', 'thickness', 'depth', 'size',
    'product width', 'overall width', 'product length', 'overall length',
    'backing thickness', 'backing thickness (imperial)'
]);

function toTitleCase(str) {
    // If it's a short all-caps acronym, leave it alone
    if (str === str.toUpperCase() && str.length <= 4) {
        return str;
    }
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase();
        }
    );
}

export function normalizeValue(attributeName, extractedValue) {
    let val = extractedValue.trim();
    let method = 'identity';
    
    const attrNameLower = attributeName.toLowerCase();
    
    // 1. Check Booleans
    if (booleanAttributes.has(attrNameLower)) {
        const valLower = val.toLowerCase();
        if (booleanTrue.has(valLower)) {
            return { normalized: 'True', method: 'boolean_rule' };
        } else if (booleanFalse.has(valLower)) {
            return { normalized: 'False', method: 'boolean_rule' };
        }
    }
    
    // 2. Check Brands
    if (attrNameLower.includes('brand') || attrNameLower.includes('manufacturer')) {
        const valLower = val.toLowerCase();
        if (brandAliases[valLower]) {
            return { normalized: brandAliases[valLower], method: 'brand_alias' };
        }
    }
    
    // 3. Check UOM and Fractions
    for (const [canonicalUnit, regex] of Object.entries(uomRegexMap)) {
        const match = val.match(regex);
        if (match) {
            let numberPart = match[1];
            let methodUsed = 'unit_alias';
            
            if (numberPart.includes('.')) {
                const parts = numberPart.split('.');
                const whole = parts[0];
                const decimal = '0.' + parts[1];
                
                if (fractionLookup[decimal]) {
                    if (whole === '0') {
                        numberPart = fractionLookup[decimal];
                    } else {
                        numberPart = `${whole}-${fractionLookup[decimal]}`;
                    }
                    methodUsed = 'fraction_lookup + unit_alias';
                }
            }
            
            return { normalized: `${numberPart} ${canonicalUnit}`, method: methodUsed };
        }
    }
    
    // 4. Fallback Fraction Check (REMOVED: Unitless decimals are strictly preserved)

    // 5. Casing
    if (titleCaseAttributes.has(attrNameLower)) {
        const origVal = val;
        val = toTitleCase(val);
        if (val !== origVal) {
            method = 'casing_rule';
        }
    }
    
    return { normalized: val, method };
}
