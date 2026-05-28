import fs from 'fs';
import path from 'path';
import * as pdfjs from 'pdfjs-dist';
import { parseDisecuritPdfText } from '../src/lib/disecurit/disecuritParser';

async function extractTextFromPdf(pdfPath: string): Promise<string> {
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = pdfjs.getDocument({ data });
    const pdf = await loadingTask.promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map((item: any) => item.str);
        fullText += strings.join(' ') + '\n';
    }
    return fullText;
}

async function smokeTest() {
    const pdfPath = path.join(process.cwd(), 'OperaçãoAuto/Operação 2588.pdf');

    console.log(`--- Smoke Test: ${pdfPath} ---`);

    if (!fs.existsSync(pdfPath)) {
        console.error('❌ PDF não encontrado na pasta OperaçãoAuto');
        return;
    }

    try {
        const text = await extractTextFromPdf(pdfPath);
        console.log('✅ Texto extraído com sucesso.');

        // Simula o comportamento do parser
        const result = parseDisecuritPdfText(text);

        console.log('\n--- Resultado do Parsing ---');
        console.log(`Programa: ${result.program}`);
        console.log(`Número Operação: ${result.document?.operation_number}`);
        console.log(`Data Pagamento: ${result.document?.payment_date}`);
        console.log(`Valor de Face: ${result.values.face_value}`);
        console.log(`Valor Líquido: ${result.values.net_value}`);
        console.log(`Documentos Encontrados: ${result.documents?.length}`);

        if (result.documents && result.documents.length > 0) {
            console.log('\nExemplo de Documento:');
            console.log(JSON.stringify(result.documents[0], null, 2));
        }

        if (result.debug?.warnings && result.debug.warnings.length > 0) {
            console.warn('\n⚠️ Avisos:', result.debug.warnings);
        }

    } catch (error) {
        console.error('❌ Erro durante o smoke test:', error);
    }
}

smokeTest();
