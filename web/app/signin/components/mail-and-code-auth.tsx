import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, useSearchParams } from 'next/navigation'
import { useContext } from 'use-context-selector'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import GreeSSO from '@/app/components/base/chat/chat-with-history/sidebar/gree-sso'
import { emailRegex } from '@/config'
import Toast from '@/app/components/base/toast'
import { sendEMailLoginCode } from '@/service/common'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/countdown'
import I18NContext from '@/context/i18n'
import { noop } from 'lodash-es'

type MailAndCodeAuthProps = {
  isInvite: boolean
}

export default function MailAndCodeAuth({ isInvite }: MailAndCodeAuthProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  const [email, setEmail] = useState(emailFromLink)
  const [loading, setIsLoading] = useState(false)
  const { locale } = useContext(I18NContext)
  const [showGreeSSO, setShowGreeSSO] = useState(false)
  const pathName = window.location.href
  const [greeSSOUrl, setGreeSSOUrl] = useState('https://wfserver.gree.com/Sso/Oauth/Show?appID=0347f117-1b67-46a1-b4ec-a173f7bffa14&sourceUrl=' + pathName)
  const handleGetEMailVerificationCode = async () => {
    try {
      if (!email) {
        Toast.notify({ type: 'error', message: t('login.error.emailEmpty') })
        return
      }

      if (!emailRegex.test(email)) {
        Toast.notify({
          type: 'error',
          message: t('login.error.emailInValid'),
        })
        return
      }
      setIsLoading(true)
      const ret = await sendEMailLoginCode(email, locale)
      if (ret.result === 'success') {
        localStorage.setItem(COUNT_DOWN_KEY, `${COUNT_DOWN_TIME_MS}`)
        const params = new URLSearchParams(searchParams)
        params.set('email', encodeURIComponent(email))
        params.set('token', encodeURIComponent(ret.data))
        router.push(`/signin/check-code?${params.toString()}`)
      }
    }
    catch (error) {
      console.error(error)
    }
    finally {
      setIsLoading(false)
    }
  }
  useEffect(() => {
    //1、先清除旧数据
    const gree_mail_tmp = localStorage.getItem('gree_mail')
    const gree_token_tmp = localStorage.getItem('gree_token')
    if (gree_mail_tmp) {
      localStorage.removeItem('gree_mail')
    }
    if (gree_token_tmp) {
      localStorage.removeItem('gree_token')
    }
    // 获取URL参数
    const urlSearchParams = new URLSearchParams(window.location.search);
    const consoleToken = urlSearchParams.get('console_token');
    const refreshToken = urlSearchParams.get('refresh_token');
    const loginGreeMail = urlSearchParams.get('gree_mail');
    const loginGreeToken = urlSearchParams.get('gree_token');
    // 单点登录跳转逻辑
    //  window.location.href = `https://wfserver.gree.com/Sso/Oauth/Show?appID=0347f117-1b67-46a1-b4ec-a173f7bffa14&sourceUrl=http://10.23.197.232/signin`
    // 步骤2：验证并存储敏感数据
    if (consoleToken && refreshToken) {
      if (loginGreeMail && loginGreeToken) {
        localStorage.setItem('gree_mail', loginGreeMail);
        localStorage.setItem('gree_token', loginGreeToken);
      }
      // 安全存储到 sessionStorage（会话级存储）
      localStorage.setItem('console_token', consoleToken);
      localStorage.setItem('refresh_token', refreshToken);

      // 步骤3：清除 URL 中的敏感参数
      router.replace('/apps');
    } else {
      const greeSSOUrltmp = 'https://wfserver.gree.com/Sso/Oauth/Show?appID=0347f117-1b67-46a1-b4ec-a173f7bffa14&sourceUrl=' + pathName
      setGreeSSOUrl(greeSSOUrltmp)
      // getIp().then((res: IPStatusResponse) => {
      //const greeSSOUrltmp = 'https://wfserver.gree.com/Sso/Oauth/Show?appID=0347f117-1b67-46a1-b4ec-a173f7bffa14&sourceUrl=http://' + res.ip_address + '/signin'
      // const greeSSOUrltmp = 'https://wfserver.gree.com/Sso/Oauth/Show?appID=0347f117-1b67-46a1-b4ec-a173f7bffa14&sourceUrl=' + pathName
      // setGreeSSOUrl(greeSSOUrltmp)
      // })
      // window.location.href = greeSSOUrl
      setShowGreeSSO(true);
    }

  }, [router]);


  return <div>{showGreeSSO && <GreeSSO openid='' sourceUrl={pathName}></GreeSSO>}</div>
  // return (<form onSubmit={noop}>
  //   <input type='text' className='hidden' />
  //   <div className='mb-2'>
  //     <label htmlFor="email" className='system-md-semibold my-2 text-text-secondary'>{t('login.email')}</label>
  //     <div className='mt-1'>
  //       <Input id='email' type="email" disabled={isInvite} value={email} placeholder={t('login.emailPlaceholder') as string} onChange={e => setEmail(e.target.value)} />
  //     </div>
  //     <div className='mt-3'>
  //       <Button loading={loading} disabled={loading || !email} variant='primary' className='w-full' onClick={handleGetEMailVerificationCode}>{t('login.signup.verifyMail')}</Button>
  //     </div>
  //   </div>
  // </form>
  // )
}
