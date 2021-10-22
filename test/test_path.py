import os
import sys

if __name__ == '__main__':
	if os.name == 'nt':
		assert(os.path.exists(os.path.expanduser("~/micromamba-bin/micromamba.exe")))
	else:
		assert(os.path.exists(os.path.expanduser("~/micromamba-bin/micromamba")))
	print(sys.path)
	print(os.path.expanduser("~/micromamba-bin"))
	assert(os.path.expanduser("~/micromamba-bin") in sys.path)
	assert(shutil.which('micromamba') is not None)
	exit(0)