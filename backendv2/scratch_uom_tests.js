const numPattern = "\\d+(?:\\.\\d+)?(?:\\/\\d+)?";
const dimsPattern = `${numPattern}(?:\\s*[x×X]\\s*${numPattern})*`;
const uomRegex = new RegExp(`^${dimsPattern}\\s+[a-zA-Z]+$`);

const testCases = [
    { val: "5 in", expected: true, desc: "Valid single" },
    { val: "1/2 in", expected: true, desc: "Valid fraction" },
    { val: "5.5 V", expected: true, desc: "Valid decimal" },
    { val: "11.2 × 5.8 × 6.2 in", expected: true, desc: "Valid multi-dimensional" },
    { val: "11.2x5.8x6.2 in", expected: true, desc: "Valid multi-dimensional without internal spaces" },
    { val: "5in", expected: false, desc: "Invalid single spacing" },
    { val: "120V", expected: false, desc: "Invalid single spacing" },
    { val: "11.2x5.8x6.2in", expected: false, desc: "Invalid multi-dimensional spacing" },
    { val: "11.2", expected: false, desc: "Invalid no unit" }
];

console.log("Running UOM Regex Tests...");
let allPassed = true;
testCases.forEach(t => {
    const passed = uomRegex.test(t.val) === t.expected;
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${t.desc}: "${t.val}" (Expected: ${t.expected}, Got: ${uomRegex.test(t.val)})`);
    if (!passed) allPassed = false;
});

console.log(allPassed ? "\\nAll tests passed successfully!" : "\\nSome tests failed.");
