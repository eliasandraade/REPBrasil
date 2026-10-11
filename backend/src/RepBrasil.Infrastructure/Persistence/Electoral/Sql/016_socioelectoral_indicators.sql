INSERT INTO indicator (code, name, unit, provider, description, derived, derivation) VALUES
    (
        'ibge.literacy_rate_15_plus',
        'Taxa de alfabetização (15+)',
        '%',
        'IBGE/SIDRA',
        'Taxa municipal de alfabetização das pessoas de 15 anos ou mais no Censo Demográfico 2022.',
        false,
        NULL
    ),
    (
        'derived.illiteracy_rate_15_plus',
        'Taxa de analfabetismo (15+)',
        '%',
        'REPBrasil',
        'Complemento da taxa oficial de alfabetização municipal das pessoas de 15 anos ou mais.',
        true,
        '100 - ibge.literacy_rate_15_plus'
    )
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    unit = EXCLUDED.unit,
    provider = EXCLUDED.provider,
    description = EXCLUDED.description,
    derived = EXCLUDED.derived,
    derivation = EXCLUDED.derivation;
