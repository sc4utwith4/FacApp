#!/usr/bin/env python3
"""
Script para validar dados extraídos
"""

import json
import sys
import re
from pathlib import Path
from typing import Dict, List, Any
from collections import Counter

BASE_DIR = Path(__file__).parent.parent.parent
INPUT_DIR = BASE_DIR / "docs" / "migracao" / "dados_extraidos"
OUTPUT_DIR = BASE_DIR / "docs" / "migracao"
LOG_DIR = BASE_DIR / "scripts" / "migracao" / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)


def validate_table_data(table_name: str, data: List[Dict]) -> Dict:
    """Valida dados de uma tabela"""
    issues = {
        "duplicates": [],
        "null_values": {},
        "invalid_dates": [],
        "invalid_numbers": [],
        "empty_strings": []
    }
    
    # Verificar duplicatas
    seen_ids = {}
    for idx, row in enumerate(data):
        if 'id' in row:
            row_id = row['id']
            if row_id in seen_ids:
                issues["duplicates"].append({
                    "id": row_id,
                    "rows": [seen_ids[row_id], idx]
                })
            else:
                seen_ids[row_id] = idx
    
    # Verificar valores nulos e strings vazias
    for idx, row in enumerate(data):
        for col_name, value in row.items():
            if value is None:
                if col_name not in issues["null_values"]:
                    issues["null_values"][col_name] = []
                issues["null_values"][col_name].append(idx)
            elif isinstance(value, str) and value.strip() == '':
                if col_name not in issues["empty_strings"]:
                    issues["empty_strings"] = []
                issues["empty_strings"].append({
                    "column": col_name,
                    "row": idx
                })
    
    # Verificar datas inválidas
    date_fields = ['data', 'created_at', 'updated_at', 'data_emissao', 'data_vencimento']
    for idx, row in enumerate(data):
        for field in date_fields:
            if field in row and row[field]:
                date_val = row[field]
                if isinstance(date_val, str):
                    # Verificar formato básico
                    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date_val):
                        issues["invalid_dates"].append({
                            "field": field,
                            "row": idx,
                            "value": date_val
                        })
    
    # Verificar números inválidos
    numeric_fields = ['valor', 'saldo', 'limite', 'taxa']
    for idx, row in enumerate(data):
        for field in numeric_fields:
            if field in row and row[field] is not None:
                try:
                    float(row[field])
                except (ValueError, TypeError):
                    issues["invalid_numbers"].append({
                        "field": field,
                        "row": idx,
                        "value": row[field]
                    })
    
    return issues


def generate_validation_report(validation_results: Dict) -> str:
    """Gera relatório de validação em Markdown"""
    
    report = """# Relatório de Validação de Dados

## Resumo

"""
    
    total_tables = len(validation_results)
    tables_with_issues = sum(1 for v in validation_results.values() if any(v.values()))
    
    report += f"- **Total de tabelas**: {total_tables}\n"
    report += f"- **Tabelas com problemas**: {tables_with_issues}\n"
    report += f"- **Tabelas sem problemas**: {total_tables - tables_with_issues}\n\n"
    
    report += "## Detalhes por Tabela\n\n"
    
    for table_name, issues in validation_results.items():
        has_issues = any(issues.values())
        
        if not has_issues:
            report += f"### {table_name} ✅\n\n"
            report += "Nenhum problema encontrado.\n\n"
            continue
        
        report += f"### {table_name} ⚠️\n\n"
        
        if issues.get("duplicates"):
            report += f"**Duplicatas**: {len(issues['duplicates'])} encontradas\n\n"
        
        if issues.get("null_values"):
            total_nulls = sum(len(v) for v in issues["null_values"].values())
            report += f"**Valores nulos**: {total_nulls} encontrados\n\n"
        
        if issues.get("invalid_dates"):
            report += f"**Datas inválidas**: {len(issues['invalid_dates'])} encontradas\n\n"
        
        if issues.get("invalid_numbers"):
            report += f"**Números inválidos**: {len(issues['invalid_numbers'])} encontrados\n\n"
        
        if issues.get("empty_strings"):
            report += f"**Strings vazias**: {len(issues['empty_strings'])} encontradas\n\n"
        
        report += "\n"
    
    return report


def main():
    """Função principal"""
    print("=" * 60)
    print("Validação de Dados Extraídos")
    print("=" * 60)
    
    if not INPUT_DIR.exists():
        print(f"Diretório de entrada não encontrado: {INPUT_DIR}")
        print("Execute primeiro: python scripts/migracao/extract_mdb_data.py")
        sys.exit(1)
    
    validation_results = {}
    
    # Processar cada diretório de dados extraídos
    for data_dir in INPUT_DIR.iterdir():
        if not data_dir.is_dir() or data_dir.name in ['transformed', 'mappings']:
            continue
        
        print(f"\nValidando: {data_dir.name}")
        
        # Processar cada arquivo JSON
        for json_file in data_dir.glob("*.json"):
            if json_file.name == "extraction_log.json":
                continue
            
            table_name = json_file.stem
            print(f"  Validando tabela: {table_name}")
            
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # Validar dados
                issues = validate_table_data(table_name, data)
                validation_results[f"{data_dir.name}.{table_name}"] = issues
                
                # Contar problemas
                total_issues = (
                    len(issues.get("duplicates", [])) +
                    sum(len(v) for v in issues.get("null_values", {}).values()) +
                    len(issues.get("invalid_dates", [])) +
                    len(issues.get("invalid_numbers", [])) +
                    len(issues.get("empty_strings", []))
                )
                
                if total_issues > 0:
                    print(f"    ⚠️  {total_issues} problemas encontrados")
                else:
                    print(f"    ✅ Nenhum problema encontrado")
                
            except Exception as e:
                print(f"    ❌ Erro ao validar {table_name}: {e}")
                validation_results[f"{data_dir.name}.{table_name}"] = {"error": str(e)}
    
    # Salvar resultados
    results_file = OUTPUT_DIR / "validacao_resultados.json"
    with open(results_file, 'w', encoding='utf-8') as f:
        json.dump(validation_results, f, ensure_ascii=False, indent=2)
    
    print(f"\nResultados salvos em: {results_file.relative_to(BASE_DIR)}")
    
    # Gerar relatório
    report = generate_validation_report(validation_results)
    report_file = OUTPUT_DIR / "validacao_relatorio.md"
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"Relatório gerado: {report_file.relative_to(BASE_DIR)}")
    
    print("\n" + "=" * 60)
    print("Validação concluída!")
    print("=" * 60)


if __name__ == "__main__":
    main()

