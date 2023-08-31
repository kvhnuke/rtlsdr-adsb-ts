{
    "targets": [
        {
            "target_name": "demod1090",
            "cflags!": ["-fno-exceptions"],
            "cflags_cc!": ["-fno-exceptions"],
            "sources": ["src/c/demod1090gyp.c", "src/c/mode-s.c"],
            "include_dirs": [
                "src/c",
                "<!(node -e \"require('nan')\")"
            ],
            'defines': ['NAPI_DISABLE_CPP_EXCEPTIONS'],
        }
    ]
}
