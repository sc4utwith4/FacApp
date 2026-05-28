#!/usr/bin/env python3
"""
Script para analisar estrutura dos arquivos .mdb e gerar documentação
"""

import json
import sys
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).parent.parent.parent
OUTPUT_DIR = BASE_DIR / "docs" / "migracao"
STRUCTURE_FILE = OUTPUT_DIR / "estrutura_access.json"


def generate_structure_doc():
    """Gera documentação Markdown da estrutura dos bancos Access"""
    
    if not STRUCTURE_FILE.exists():
        print(f"Arquivo de estrutura não encontrado: {STRUCTURE_FILE}")
        print("Execute primeiro: python scripts/migracao/extract_mdb_data.py")
        sys.exit(1)
    
    with open(STRUCTURE_FILE, 'r', encoding='utf-8') as f:
        structures = json.load(f)
    
    doc_content = f"""# Estrutura dos Bancos Access (.mdb)

Documento gerado automaticamente em {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## Arquivos Analisados

"""
    
    for file_name, structure in structures.items():
        doc_content += f"""### {file_name}

- **Caminho**: `{structure['file']}`
- **Tamanho**: {structure['file_size']:,} bytes ({structure['file_size'] / 1024 / 1024:.2f} MB)
- **Hash MD5**: `{structure['file_hash']}`
- **Modificado**: {structure['modified_time']}
- **Tabelas**: {len(structure.get('tables', {}))}

#### Tabelas

"""
        
        for table_name, table_info in structure.get('tables', {}).items():
            doc_content += f"""##### {table_name}

- **Colunas**: {len(table_info.get('columns', {}))}
- **Amostra**: {table_info.get('sample_count', 0)} registros

**Colunas:**

| Nome | Tipo | Nullable |
|------|------|----------|
"""
            
            for col_name, col_info in table_info.get('columns', {}).items():
                col_type = col_info.get('type', 'UNKNOWN')
                nullable = 'Sim' if col_info.get('nullable', False) else 'Não'
                doc_content += f"| `{col_name}` | {col_type} | {nullable} |\n"
            
            doc_content += "\n"
    
    # Salvar documentação
    doc_file = OUTPUT_DIR / "estrutura_access.md"
    with open(doc_file, 'w', encoding='utf-8') as f:
        f.write(doc_content)
    
    print(f"Documentação gerada: {doc_file.relative_to(BASE_DIR)}")
    
    # Gerar resumo JSON também
    summary = {
        "generated_at": datetime.now().isoformat(),
        "files": {}
    }
    
    for file_name, structure in structures.items():
        summary["files"][file_name] = {
            "file_size": structure['file_size'],
            "file_hash": structure['file_hash'],
            "table_count": len(structure.get('tables', {})),
            "tables": list(structure.get('tables', {}).keys())
        }
    
    summary_file = OUTPUT_DIR / "estrutura_resumo.json"
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    
    print(f"Resumo gerado: {summary_file.relative_to(BASE_DIR)}")


if __name__ == "__main__":
    generate_structure_doc()

