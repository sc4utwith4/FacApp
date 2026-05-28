#!/usr/bin/env python3
"""
Script para transformar e limpar dados extraídos do Access
"""

import json
import sys
import re
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime
import uuid

BASE_DIR = Path(__file__).parent.parent.parent
INPUT_DIR = BASE_DIR / "docs" / "migracao" / "dados_extraidos"
OUTPUT_DIR = BASE_DIR / "docs" / "migracao" / "dados_extraidos" / "transformed"
MAPPING_DIR = BASE_DIR / "docs" / "migracao" / "dados_extraidos" / "mappings"

# Criar diretórios
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MAPPING_DIR.mkdir(parents=True, exist_ok=True)


def normalize_cnpj(cnpj: str) -> Optional[str]:
    """Normaliza CNPJ removendo caracteres especiais"""
    if not cnpj:
        return None
    cnpj_clean = re.sub(r'[^\d]', '', str(cnpj))
    if len(cnpj_clean) == 14:
        return cnpj_clean
    return None


def normalize_cpf(cpf: str) -> Optional[str]:
    """Normaliza CPF removendo caracteres especiais"""
    if not cpf:
        return None
    cpf_clean = re.sub(r'[^\d]', '', str(cpf))
    if len(cpf_clean) == 11:
        return cpf_clean
    return None


def normalize_phone(phone: str) -> Optional[str]:
    """Normaliza telefone removendo caracteres especiais"""
    if not phone:
        return None
    phone_clean = re.sub(r'[^\d]', '', str(phone))
    if phone_clean:
        return phone_clean
    return None


def parse_date(date_str: Any) -> Optional[str]:
    """Converte data de vários formatos para ISO (YYYY-MM-DD)"""
    if not date_str:
        return None
    
    if isinstance(date_str, datetime):
        return date_str.strftime('%Y-%m-%d')
    
    date_str = str(date_str).strip()
    
    # Tentar diferentes formatos
    formats = [
        '%Y-%m-%d',
        '%d/%m/%Y',
        '%d-%m-%Y',
        '%m/%d/%Y',
        '%Y/%m/%d',
        '%d.%m.%Y',
    ]
    
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            continue
    
    # Se não conseguir parsear, retornar None
    return None


def parse_decimal(value: Any) -> Optional[float]:
    """Converte valor para decimal"""
    if value is None:
        return None
    
    if isinstance(value, (int, float)):
        return float(value)
    
    if isinstance(value, str):
        # Remover caracteres não numéricos exceto ponto e vírgula
        value_clean = re.sub(r'[^\d.,-]', '', value)
        # Substituir vírgula por ponto
        value_clean = value_clean.replace(',', '.')
        try:
            return float(value_clean)
        except ValueError:
            return None
    
    return None


def normalize_string(value: Any) -> Optional[str]:
    """Normaliza string (trim, uppercase)"""
    if value is None:
        return None
    
    if isinstance(value, str):
        return value.strip().upper() if value.strip() else None
    
    return str(value).strip().upper() if str(value).strip() else None


def create_id_mapping(table_name: str, legacy_id: Any) -> str:
    """Cria mapeamento de ID legado para UUID"""
    mapping_file = MAPPING_DIR / f"{table_name}_mapping.json"
    
    if mapping_file.exists():
        with open(mapping_file, 'r', encoding='utf-8') as f:
            mappings = json.load(f)
    else:
        mappings = {}
    
    legacy_id_str = str(legacy_id)
    
    if legacy_id_str not in mappings:
        mappings[legacy_id_str] = str(uuid.uuid4())
        with open(mapping_file, 'w', encoding='utf-8') as f:
            json.dump(mappings, f, ensure_ascii=False, indent=2)
    
    return mappings[legacy_id_str]


def transform_table_data(table_name: str, data: List[Dict], table_config: Dict) -> List[Dict]:
    """Transforma dados de uma tabela"""
    transformed = []
    
    for row in data:
        transformed_row = {}
        
        for col_name, value in row.items():
            # Aplicar transformações baseadas no tipo de campo
            if col_name in table_config.get('date_fields', []):
                transformed_row[col_name] = parse_date(value)
            elif col_name in table_config.get('decimal_fields', []):
                transformed_row[col_name] = parse_decimal(value)
            elif col_name in table_config.get('cnpj_fields', []):
                transformed_row[col_name] = normalize_cnpj(value)
            elif col_name in table_config.get('cpf_fields', []):
                transformed_row[col_name] = normalize_cpf(value)
            elif col_name in table_config.get('phone_fields', []):
                transformed_row[col_name] = normalize_phone(value)
            elif col_name in table_config.get('string_fields', []):
                transformed_row[col_name] = normalize_string(value)
            else:
                # Manter valor original, mas tratar None
                transformed_row[col_name] = value if value not in ('', None) else None
        
        # Adicionar UUID se necessário
        if 'id' in transformed_row and table_config.get('generate_uuid', False):
            legacy_id = transformed_row.get('id')
            if legacy_id:
                transformed_row['legacy_id'] = legacy_id
                transformed_row['id'] = create_id_mapping(table_name, legacy_id)
        
        transformed.append(transformed_row)
    
    return transformed


def load_table_config() -> Dict:
    """Carrega configuração de transformação por tabela"""
    config_file = BASE_DIR / "scripts" / "migracao" / "transform_config.json"
    
    if config_file.exists():
        with open(config_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    # Configuração padrão
    return {
        "empresas": {
            "date_fields": ["created_at", "updated_at"],
            "cnpj_fields": ["cnpj"],
            "string_fields": ["nome", "razao_social"],
            "generate_uuid": True
        },
        "clientes": {
            "date_fields": ["created_at", "updated_at"],
            "cnpj_fields": ["cnpj"],
            "cpf_fields": ["cpf"],
            "phone_fields": ["telefone"],
            "string_fields": ["nome", "razao_social"],
            "generate_uuid": True
        },
        "fornecedores": {
            "date_fields": ["created_at", "updated_at"],
            "cnpj_fields": ["cnpj"],
            "phone_fields": ["telefone"],
            "string_fields": ["nome", "razao_social"],
            "generate_uuid": True
        }
    }


def main():
    """Função principal"""
    print("=" * 60)
    print("Transformação de Dados - Access para PostgreSQL")
    print("=" * 60)
    
    if not INPUT_DIR.exists():
        print(f"Diretório de entrada não encontrado: {INPUT_DIR}")
        print("Execute primeiro: python scripts/migracao/extract_mdb_data.py")
        sys.exit(1)
    
    # Carregar configuração
    table_config = load_table_config()
    
    # Processar cada diretório de dados extraídos
    for data_dir in INPUT_DIR.iterdir():
        if not data_dir.is_dir() or data_dir.name in ['transformed', 'mappings']:
            continue
        
        print(f"\nProcessando: {data_dir.name}")
        
        # Criar diretório de saída
        output_subdir = OUTPUT_DIR / data_dir.name
        output_subdir.mkdir(parents=True, exist_ok=True)
        
        # Processar cada arquivo JSON
        for json_file in data_dir.glob("*.json"):
            if json_file.name == "extraction_log.json":
                continue
            
            table_name = json_file.stem
            print(f"  Transformando tabela: {table_name}")
            
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # Obter configuração da tabela
                config = table_config.get(table_name, {})
                
                # Transformar dados
                transformed_data = transform_table_data(table_name, data, config)
                
                # Salvar dados transformados
                output_file = output_subdir / f"{table_name}.json"
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(transformed_data, f, ensure_ascii=False, indent=2, default=str)
                
                print(f"    Transformados {len(transformed_data)} registros")
                
            except Exception as e:
                print(f"    Erro ao transformar {table_name}: {e}")
    
    print("\n" + "=" * 60)
    print("Transformação concluída!")
    print(f"Dados transformados salvos em: {OUTPUT_DIR.relative_to(BASE_DIR)}")
    print("=" * 60)


if __name__ == "__main__":
    main()

