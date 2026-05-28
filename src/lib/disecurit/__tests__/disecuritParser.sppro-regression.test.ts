import { describe, expect, it } from 'vitest';
import { parseDisecuritPdfText } from '../disecuritParser';
import { spproRealRegressionFixtures } from './fixtures/spproRealRegressionFixtures';

const roundToCents = (value: number): number => Number(value.toFixed(2));

const calculateSpproNetValue = (input: {
  face_value: number;
  purchase_value: number;
  ad_valorem: number;
  iss: number;
  despesas: number;
  iof: number;
  iof_additional: number;
  recompra: number;
}): number =>
  roundToCents(
    input.face_value -
      input.purchase_value -
      input.ad_valorem -
      input.iss -
      input.despesas -
      input.iof -
      input.iof_additional -
      input.recompra
  );

describe('disecuritParser SPPRO regression (strict field match)', () => {
  it.each(spproRealRegressionFixtures)(
    'parseia fixture real $id com contrato estrito por campo',
    ({ rawText, expected }) => {
      const parsed = parseDisecuritPdfText(rawText, 'SPPRO');
      const formula = parsed.debug?.sppro_formula;

      expect(parsed.program).toBe('SPPRO');
      expect(parsed.document.bordero_number).toBe(expected.bordero_number);
      expect(parsed.document.date).toBe(expected.date);

      expect(parsed.values.face_value).toBeCloseTo(expected.face_value, 2);
      expect(parsed.values.purchase_value).toBeCloseTo(expected.purchase_value, 2);
      expect(parsed.values.ad_valorem).toBeCloseTo(expected.ad_valorem, 2);
      expect(parsed.values.iss).toBeCloseTo(expected.iss, 2);
      expect(parsed.values.expenses).toBeCloseTo(expected.despesas, 2);
      expect(parsed.values.iof).toBeCloseTo(expected.iof, 2);
      expect(parsed.values.iof_additional).toBeCloseTo(expected.iof_additional, 2);
      expect(parsed.values.recompra).toBeCloseTo(expected.recompra, 2);
      expect(parsed.values.net_value).toBeCloseTo(expected.net_value, 2);

      expect(formula?.valor_face.value).toBeCloseTo(expected.face_value, 2);
      expect(formula?.valor_compra.value).toBeCloseTo(expected.purchase_value, 2);
      expect(formula?.ad_valorem.value).toBeCloseTo(expected.ad_valorem, 2);
      expect(formula?.iss.value).toBeCloseTo(expected.iss, 2);
      expect(formula?.despesas.value).toBeCloseTo(expected.despesas, 2);
      expect(formula?.iof.value).toBeCloseTo(expected.iof, 2);
      expect(formula?.iof_adicional.value).toBeCloseTo(expected.iof_additional, 2);
      expect(formula?.recompra.value).toBeCloseTo(expected.recompra, 2);
      expect(formula?.liquido_operacao.value).toBeCloseTo(expected.net_value, 2);

      const netByFormula = calculateSpproNetValue(expected);
      expect(netByFormula).toBeCloseTo(expected.net_value, 2);
      expect(parsed.values.net_value).toBeCloseTo(netByFormula, 2);

      expect(parsed.values.purchase_value).not.toBeCloseTo(expected.net_value, 2);
      expect(['before_label', 'direct_label', 'after_label']).toContain(parsed.debug?.regex_matches?.net_value_match_type);
    }
  );
});
