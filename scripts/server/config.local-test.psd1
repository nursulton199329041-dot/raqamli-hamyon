# LOKAL TEST server profili (hozirgi ish rejimi). Sirlar bu faylda EMAS.
@{
  Profile      = 'local-test'
  Root         = 'D:\RaqamliHamyonLocal'
  AspNetEnv    = 'Development'          # swagger + HTTP; faqat lokal tarmoq
  ApiUrls      = 'http://0.0.0.0:5080'  # telefon LAN orqali ulanadi; firewall LocalSubnet bilan cheklangan
  HealthUrl    = 'http://127.0.0.1:5080/health'
  PgPort       = 55433
  PgHost       = '127.0.0.1'            # PostgreSQL faqat loopback
  DbName       = 'hamyon_dev'           # MAVJUD baza - nomini o'zgartirmang
  DbUser       = 'postgres'
  JwtSecretFile= 'D:\RaqamliHamyonLocal\jwt.secret'
  LogKeepDays  = 14
  BackupKeep   = 7
}
