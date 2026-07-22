"""Schedule exporters — the return leg of app/importers.

Every exporter consumes the same normalized ImportedSchedule the importers
produce, so any supported input format can be written back out as any supported
output format.

    xer   Primavera P6 tab-delimited exchange
    xml   MS Project MSPDI (opens natively in MS Project; save-as for .mpp)
    csv   flat activity list for Excel / Ministry packs
"""
from .csv_exporter import write_csv
from .msp_exporter import write_msp_xml
from .xer_exporter import write_xer

FORMATS = {
    "xer": ("application/octet-stream", ".xer", write_xer),
    "xml": ("application/xml", ".xml", write_msp_xml),
    "csv": ("text/csv", ".csv", write_csv),
}

__all__ = ["write_xer", "write_msp_xml", "write_csv", "FORMATS"]
