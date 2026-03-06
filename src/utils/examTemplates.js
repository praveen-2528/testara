export const EXAM_TEMPLATES = {
    ssc_cgl_tier1: {
        id: 'ssc_cgl_tier1',
        name: 'SSC CGL Tier-1',
        optionsPerQuestion: 4,
        durationSeconds: 3600, // 60 mins
        markingScheme: { correct: 2, incorrect: -0.5, unattempted: 0 },
        subjects: [
            {
                id: 'reasoning', name: 'General Intelligence & Reasoning', count: 25,
                topics: ['Analogies', 'Classification', 'Series', 'Coding-Decoding', 'Blood Relations', 'Direction Sense', 'Syllogism', 'Matrix', 'Word Arrangement', 'Venn Diagrams', 'Missing Numbers', 'Statement & Conclusion', 'Paper Folding & Cutting', 'Mirror & Water Image']
            },
            {
                id: 'awareness', name: 'General Awareness', count: 25,
                topics: ['Indian History', 'Geography', 'Polity & Constitution', 'Economics', 'General Science', 'Physics', 'Chemistry', 'Biology', 'Current Affairs', 'Static GK', 'Awards & Honours', 'Books & Authors', 'Sports']
            },
            {
                id: 'quant', name: 'Quantitative Aptitude', count: 25,
                topics: ['Number System', 'HCF & LCM', 'Simplification', 'Percentage', 'Ratio & Proportion', 'Average', 'Profit & Loss', 'Simple Interest', 'Compound Interest', 'Time & Work', 'Time Speed Distance', 'Algebra', 'Geometry', 'Trigonometry', 'Mensuration', 'Data Interpretation']
            },
            {
                id: 'english', name: 'English Comprehension', count: 25,
                topics: ['Reading Comprehension', 'Cloze Test', 'Fill in the Blanks', 'Spelling Correction', 'Idioms & Phrases', 'One Word Substitution', 'Sentence Improvement', 'Active & Passive Voice', 'Direct & Indirect Speech', 'Error Spotting', 'Synonyms & Antonyms', 'Para Jumbles']
            },
        ]
    },
    ibps_po_pre: {
        id: 'ibps_po_pre',
        name: 'IBPS PO Prelims',
        optionsPerQuestion: 5,
        durationSeconds: 3600, // 60 mins
        markingScheme: { correct: 1, incorrect: -0.25, unattempted: 0 },
        subjects: [
            {
                id: 'english', name: 'English Language', count: 30,
                topics: ['Reading Comprehension', 'Cloze Test', 'Fill in the Blanks', 'Error Spotting', 'Para Jumbles', 'Sentence Rearrangement', 'Vocabulary', 'Idioms & Phrases', 'Sentence Completion', 'Word Usage']
            },
            {
                id: 'quant', name: 'Quantitative Aptitude', count: 35,
                topics: ['Number Series', 'Simplification', 'Data Interpretation', 'Quadratic Equations', 'Percentage', 'Ratio & Proportion', 'Profit & Loss', 'Time & Work', 'Time Speed Distance', 'Simple & Compound Interest', 'Average', 'Mixture & Alligation', 'Probability', 'Permutation & Combination']
            },
            {
                id: 'reasoning', name: 'Reasoning Ability', count: 35,
                topics: ['Seating Arrangement', 'Puzzle', 'Syllogism', 'Inequality', 'Coding-Decoding', 'Blood Relations', 'Direction Sense', 'Order & Ranking', 'Machine Input-Output', 'Data Sufficiency', 'Alphabet & Number Series', 'Logical Reasoning']
            },
        ]
    },
    rrb_ntpc_cbt1: {
        id: 'rrb_ntpc_cbt1',
        name: 'RRB NTPC CBT-1',
        optionsPerQuestion: 4,
        durationSeconds: 5400, // 90 mins
        markingScheme: { correct: 1, incorrect: -0.33, unattempted: 0 },
        subjects: [
            {
                id: 'awareness', name: 'General Awareness', count: 40,
                topics: ['Indian History', 'Geography', 'Indian Economy', 'Polity & Governance', 'General Science', 'Current Affairs', 'Indian Culture', 'Famous Personalities', 'Awards & Honours', 'Sports', 'Important Dates', 'National & International Organizations']
            },
            {
                id: 'math', name: 'Mathematics', count: 30,
                topics: ['Number System', 'Decimals & Fractions', 'LCM & HCF', 'Ratio & Proportion', 'Percentage', 'Mensuration', 'Time & Work', 'Time Speed Distance', 'Simple & Compound Interest', 'Profit & Loss', 'Algebra', 'Geometry & Trigonometry', 'Statistics']
            },
            {
                id: 'reasoning', name: 'General Intelligence & Reasoning', count: 30,
                topics: ['Analogies', 'Classification', 'Number Series', 'Coding-Decoding', 'Syllogism', 'Blood Relations', 'Direction Sense', 'Statement & Conclusion', 'Venn Diagrams', 'Calendar & Clock', 'Mirror & Water Image', 'Mathematical Operations']
            },
        ]
    }
};
