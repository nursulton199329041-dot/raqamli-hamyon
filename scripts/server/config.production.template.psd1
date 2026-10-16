# PRODUCTION profili SHABLONI. Bu mashinada ISHLATILMAYDI; alohida serverda to'ldiriladi.
# Sirlar (JWT, DB paroli) faylga yozilmaydi: muhit o'zgaruvchisi yoki sir-fayl (ACL bilan).
@{
  Profile      = 'production'
  Root         = 'D:\RaqamliHamyonProd'          # lokal-test ma'lumotlaridan ALOHIDA papka
  AspNetEnv    = 'Production'                    # swagger o'chiq, HTTPS redirect, Jwt__Secret majburiy
  ApiUrls      = 'http://127.0.0.1:5090'         # faqat reverse proxy (TLS) ortida; to'g'ridan-to'g'ri ochilmaydi
  HealthUrl    = 'http://127.0.0.1:5090/health'
  PgPort       = 55434
  PgHost       = '127.0.0.1'
  DbName       = 'hamyon_prod'                   # alohida baza
  DbUser       = 'hamyon_app'                    # superuser EMAS, parol bilan
  JwtSecretFile= 'D:\RaqamliHamyonProd\secrets\jwt.secret'
  LogKeepDays  = 30
  BackupKeep   = 14
}
