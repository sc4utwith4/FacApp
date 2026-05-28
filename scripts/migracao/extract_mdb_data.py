#!/usr/bin/env python3
"""
Script para extrair dados de arquivos .mdb (Microsoft Access)
Suporta mdb-tools (macOS/Linux) e pyodbc (Windows/com driver)
"""

import os
import sys
import json
import subprocess
import hashlib
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import csv

try:
    import pandas as pd
except ImportError:
    print("Erro: pandas não instalado. Execute: pip install -r requirements.txt")
    sys.exit(1)

# Configurações
BASE_DIR = Path(__file__).parent.parent.parent
MDB_DIR = BASE_DIR / "docs" / "PlataformaAntigaDados"
OUTPUT_DIR = BASE_DIR / "docs" / "migracao" / "dados_extraidos"
LOG_DIR = BASE_DIR / "scripts" / "migracao" / "logs"

# Criar diretórios se não existirem
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)


def calculate_file_hash(file_path: Path) -> str:
    """Calcula hash MD5 de um arquivo"""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def check_duplicate_files(mdb_files: List[Path]) -> Dict[str, List[Path]]:
    """Identifica arquivos duplicados comparando hash"""
    file_hashes = {}
    duplicates = {}
    
    for mdb_file in mdb_files:
        if not mdb_file.exists():
            continue
        file_hash = calculate_file_hash(mdb_file)
        if file_hash in file_hashes:
            if file_hash not in duplicates:
                duplicates[file_hash] = [file_hashes[file_hash]]
            duplicates[file_hash].append(mdb_file)
        else:
            file_hashes[file_hash] = mdb_file
    
    return duplicates


def check_mdb_tools() -> bool:
    """Verifica se mdb-tools está instalado"""
    try:
        # Tentar mdb-tables --version (comando mais comum)
        result = subprocess.run(
            ["mdb-tables", "--version"], 
            capture_output=True, 
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            return True
        # Tentar mdb-version como fallback
        result = subprocess.run(
            ["mdb-version"], 
            capture_output=True, 
            text=True,
            timeout=5
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def check_pyodbc() -> bool:
    """Verifica se pyodbc está disponível"""
    try:
        import pyodbc
        return True
    except ImportError:
        return False


def list_tables_mdb_tools(mdb_file: Path) -> List[str]:
    """Lista tabelas usando mdb-tools"""
    try:
        result = subprocess.run(
            ["mdb-tables", str(mdb_file)],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            tables = [t.strip() for t in result.stdout.strip().split() if t.strip()]
            return tables
        else:
            print(f"Erro ao listar tabelas: {result.stderr}")
            return []
    except Exception as e:
        print(f"Erro ao executar mdb-tools: {e}")
        return []


def get_table_schema_mdb_tools(mdb_file: Path, table_name: str) -> List[Dict]:
    """Obtém schema de uma tabela usando mdb-tools"""
    try:
        result = subprocess.run(
            ["mdb-schema", str(mdb_file), "-T", table_name],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            # Parse básico do schema (simplificado)
            # mdb-schema retorna SQL DDL
            return [{"schema_sql": result.stdout}]
        return []
    except Exception as e:
        print(f"Erro ao obter schema: {e}")
        return []


def extract_table_mdb_tools(mdb_file: Path, table_name: str, chunk_size: int = 1000) -> List[Dict]:
    """Extrai dados de uma tabela usando mdb-tools com paginação"""
    data = []
    try:
        # mdb-export exporta para CSV
        result = subprocess.run(
            ["mdb-export", str(mdb_file), table_name],
            capture_output=True,
            text=True,
            timeout=300,
            encoding='utf-8',
            errors='replace'
        )
        
        if result.returncode == 0:
            # Parse CSV
            csv_reader = csv.DictReader(result.stdout.splitlines())
            for row in csv_reader:
                # Converter valores vazios para None
                cleaned_row = {}
                for key, value in row.items():
                    if value == '' or value is None:
                        cleaned_row[key] = None
                    else:
                        cleaned_row[key] = value
                data.append(cleaned_row)
        else:
            print(f"Erro ao extrair tabela {table_name}: {result.stderr}")
    
    except Exception as e:
        print(f"Erro ao extrair tabela {table_name}: {e}")
    
    return data


def list_tables_pyodbc(mdb_file: Path) -> List[str]:
    """Lista tabelas usando pyodbc"""
    try:
        import pyodbc
        conn_str = f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={mdb_file};"
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        tables = []
        for table_info in cursor.tables(tableType='TABLE'):
            tables.append(table_info.table_name)
        
        conn.close()
        return tables
    except Exception as e:
        print(f"Erro ao conectar com pyodbc: {e}")
        return []


def extract_table_pyodbc(mdb_file: Path, table_name: str, chunk_size: int = 1000) -> List[Dict]:
    """Extrai dados de uma tabela usando pyodbc com paginação"""
    data = []
    try:
        import pyodbc
        conn_str = f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={mdb_file};"
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        cursor.execute(f"SELECT * FROM [{table_name}]")
        columns = [column[0] for column in cursor.description]
        
        while True:
            rows = cursor.fetchmany(chunk_size)
            if not rows:
                break
            
            for row in rows:
                row_dict = {}
                for i, col in enumerate(columns):
                    value = row[i]
                    # Converter valores para tipos Python nativos
                    if value is None:
                        row_dict[col] = None
                    elif isinstance(value, bytes):
                        row_dict[col] = value.decode('utf-8', errors='replace')
                    else:
                        row_dict[col] = value
                data.append(row_dict)
        
        conn.close()
    except Exception as e:
        print(f"Erro ao extrair tabela {table_name}: {e}")
    
    return data


def analyze_mdb_structure(mdb_file: Path, use_mdb_tools: bool = True) -> Dict:
    """Analisa estrutura completa de um arquivo .mdb"""
    print(f"\nAnalisando: {mdb_file.name}")
    
    # Listar tabelas
    if use_mdb_tools:
        tables = list_tables_mdb_tools(mdb_file)
    else:
        tables = list_tables_pyodbc(mdb_file)
    
    if not tables:
        print(f"  Nenhuma tabela encontrada ou erro ao listar tabelas")
        return {}
    
    print(f"  Encontradas {len(tables)} tabelas")
    
    structure = {
        "file": str(mdb_file),
        "file_name": mdb_file.name,
        "file_size": mdb_file.stat().st_size,
        "file_hash": calculate_file_hash(mdb_file),
        "modified_time": datetime.fromtimestamp(mdb_file.stat().st_mtime).isoformat(),
        "tables": {}
    }
    
    # Analisar cada tabela
    for table in tables:
        print(f"  Analisando tabela: {table}")
        
        # Extrair amostra de dados para inferir tipos
        if use_mdb_tools:
            sample_data = extract_table_mdb_tools(mdb_file, table, chunk_size=10)
        else:
            sample_data = extract_table_pyodbc(mdb_file, table, chunk_size=10)
        
        if sample_data:
            columns = {}
            for col_name in sample_data[0].keys():
                # Inferir tipo básico
                sample_values = [row.get(col_name) for row in sample_data if row.get(col_name) is not None]
                col_type = "TEXT"
                if sample_values:
                    first_val = sample_values[0]
                    if isinstance(first_val, (int, float)):
                        col_type = "NUMERIC"
                    elif isinstance(first_val, datetime):
                        col_type = "DATE"
                
                columns[col_name] = {
                    "type": col_type,
                    "nullable": any(row.get(col_name) is None for row in sample_data)
                }
            
            structure["tables"][table] = {
                "columns": columns,
                "sample_count": len(sample_data),
                "estimated_total": None  # Será preenchido na extração completa
            }
    
    return structure


def extract_all_tables(mdb_file: Path, output_subdir: Path, use_mdb_tools: bool = True) -> Dict:
    """Extrai todas as tabelas de um arquivo .mdb"""
    print(f"\nExtraindo dados de: {mdb_file.name}")
    
    # Listar tabelas
    if use_mdb_tools:
        tables = list_tables_mdb_tools(mdb_file)
    else:
        tables = list_tables_pyodbc(mdb_file)
    
    if not tables:
        print(f"  Nenhuma tabela encontrada")
        return {}
    
    extraction_log = {
        "file": str(mdb_file),
        "extracted_at": datetime.now().isoformat(),
        "tables": {}
    }
    
    output_subdir.mkdir(parents=True, exist_ok=True)
    
    for table in tables:
        print(f"  Extraindo tabela: {table}")
        
        try:
            if use_mdb_tools:
                data = extract_table_mdb_tools(mdb_file, table)
            else:
                data = extract_table_pyodbc(mdb_file, table)
            
            if data:
                # Salvar como JSON
                json_file = output_subdir / f"{table}.json"
                with open(json_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2, default=str)
                
                # Salvar como CSV também
                csv_file = output_subdir / f"{table}.csv"
                if data:
                    df = pd.DataFrame(data)
                    df.to_csv(csv_file, index=False, encoding='utf-8')
                
                extraction_log["tables"][table] = {
                    "row_count": len(data),
                    "json_file": str(json_file.relative_to(OUTPUT_DIR)),
                    "csv_file": str(csv_file.relative_to(OUTPUT_DIR))
                }
                
                print(f"    Extraídos {len(data)} registros")
            else:
                print(f"    Nenhum dado extraído")
                extraction_log["tables"][table] = {
                    "row_count": 0,
                    "error": "Nenhum dado encontrado"
                }
        
        except Exception as e:
            print(f"    Erro ao extrair: {e}")
            extraction_log["tables"][table] = {
                "row_count": 0,
                "error": str(e)
            }
    
    # Salvar log de extração
    log_file = output_subdir / "extraction_log.json"
    with open(log_file, 'w', encoding='utf-8') as f:
        json.dump(extraction_log, f, ensure_ascii=False, indent=2)
    
    return extraction_log


def main():
    """Função principal"""
    print("=" * 60)
    print("Extrator de Dados - Microsoft Access (.mdb)")
    print("=" * 60)
    
    # Verificar ferramentas disponíveis
    use_mdb_tools = check_mdb_tools()
    use_pyodbc = check_pyodbc()
    
    if not use_mdb_tools and not use_pyodbc:
        print("\nERRO: Nenhuma ferramenta disponível!")
        print("Opções:")
        print("  1. Instalar mdb-tools: brew install mdb-tools (macOS)")
        print("  2. Instalar pyodbc: pip install pyodbc (requer driver Access)")
        sys.exit(1)
    
    if use_mdb_tools:
        print("\nUsando: mdb-tools")
    else:
        print("\nUsando: pyodbc")
    
    # Encontrar arquivos .mdb
    mdb_files = list(MDB_DIR.rglob("*.mdb"))
    
    if not mdb_files:
        print(f"\nNenhum arquivo .mdb encontrado em {MDB_DIR}")
        sys.exit(1)
    
    print(f"\nEncontrados {len(mdb_files)} arquivos .mdb:")
    for mdb_file in mdb_files:
        print(f"  - {mdb_file.relative_to(BASE_DIR)}")
    
    # Verificar duplicatas
    print("\nVerificando arquivos duplicados...")
    duplicates = check_duplicate_files(mdb_files)
    
    if duplicates:
        print("\nArquivos duplicados encontrados:")
        for file_hash, files in duplicates.items():
            print(f"  Hash: {file_hash[:16]}...")
            for f in files:
                print(f"    - {f.name} ({f.stat().st_size} bytes, modificado: {datetime.fromtimestamp(f.stat().st_mtime).strftime('%Y-%m-%d %H:%M:%S')})")
        
        # Usar o arquivo mais recente de cada grupo
        unique_files = []
        for file_hash, files in duplicates.items():
            # Ordenar por data de modificação (mais recente primeiro)
            files_sorted = sorted(files, key=lambda f: f.stat().st_mtime, reverse=True)
            unique_files.append(files_sorted[0])
            print(f"  Usando: {files_sorted[0].name} (mais recente)")
        
        # Adicionar arquivos únicos
        for mdb_file in mdb_files:
            is_duplicate = False
            for file_hash, files in duplicates.items():
                if mdb_file in files:
                    is_duplicate = True
                    break
            if not is_duplicate:
                unique_files.append(mdb_file)
        
        mdb_files = unique_files
    
    # Analisar estrutura
    print("\n" + "=" * 60)
    print("FASE 1: Análise de Estrutura")
    print("=" * 60)
    
    all_structures = {}
    for mdb_file in mdb_files:
        structure = analyze_mdb_structure(mdb_file, use_mdb_tools=use_mdb_tools)
        if structure:
            all_structures[mdb_file.name] = structure
    
    # Salvar análise de estrutura
    structure_file = OUTPUT_DIR / "estrutura_access.json"
    with open(structure_file, 'w', encoding='utf-8') as f:
        json.dump(all_structures, f, ensure_ascii=False, indent=2)
    
    print(f"\nEstrutura salva em: {structure_file.relative_to(BASE_DIR)}")
    
    # Extrair dados
    print("\n" + "=" * 60)
    print("FASE 2: Extração de Dados")
    print("=" * 60)
    
    for mdb_file in mdb_files:
        # Criar subdiretório para este arquivo
        file_stem = mdb_file.stem.replace(" ", "_").replace("Cópia_de", "copia")
        output_subdir = OUTPUT_DIR / file_stem
        
        extraction_log = extract_all_tables(mdb_file, output_subdir, use_mdb_tools=use_mdb_tools)
        
        if extraction_log:
            print(f"\nExtração concluída: {mdb_file.name}")
            total_tables = len(extraction_log.get("tables", {}))
            total_rows = sum(t.get("row_count", 0) for t in extraction_log.get("tables", {}).values())
            print(f"  Tabelas: {total_tables}, Total de registros: {total_rows}")
    
    print("\n" + "=" * 60)
    print("Extração concluída!")
    print(f"Dados salvos em: {OUTPUT_DIR.relative_to(BASE_DIR)}")
    print("=" * 60)


if __name__ == "__main__":
    main()

