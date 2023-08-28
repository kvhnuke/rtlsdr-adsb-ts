{
    "targets": [
        {
            "target_name": "demodulator",
            "cflags!": ["-fno-exceptions"],
            "cflags_cc!": ["-fno-exceptions"],
            "sources": ["src/c/demodulator.c", "src/c/mode-s.c"],
            "include_dirs": [
                "src/c",
                "<!(node -e \"require('nan')\")"
            ],
            'defines': ['NAPI_DISABLE_CPP_EXCEPTIONS'],
        }
    ]
}
