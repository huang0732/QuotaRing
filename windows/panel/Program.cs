using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyTitle("QuotaRing")]
[assembly: System.Reflection.AssemblyProduct("QuotaRing")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.1.0")]
[assembly: System.Reflection.AssemblyInformationalVersion("1.0.1")]

static class Native {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; public Rectangle Box {get{return Rectangle.FromLTRB(Left,Top,Right,Bottom);}} }
    [StructLayout(LayoutKind.Sequential)] public struct AppBar {public uint Size;public IntPtr Window;public uint Callback,Edge;public Rect Bounds;public IntPtr Param;}
    [StructLayout(LayoutKind.Sequential)] public struct Point {public int X,Y;public Point(int x,int y){X=x;Y=y;}}
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string name,string title);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent,IntPtr child,string name,string title);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect rect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window,uint flags);
    [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr window,int index);
    [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr window,out uint color,out byte alpha,out uint flags);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window,int attr,out int value,int size);
    [DllImport("shell32.dll",CharSet=CharSet.Unicode)] public static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window,System.Text.StringBuilder name,int length);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint message,ref AppBar data);
    [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window,int attr,out Rect rect,int size);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int left,int top,int right,int bottom,int width,int height);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr handle);
    public static bool CoversScreen(Rectangle window,Rectangle screen) {return window.Left<=screen.Left+2&&window.Top<=screen.Top+2&&window.Right>=screen.Right-2&&window.Bottom>=screen.Bottom-2;}
    public static object Visibility(Form form) {
        int cloaked;DwmGetWindowAttribute(form.Handle,14,out cloaked,4);
        uint color,flags;byte alpha;bool layered=GetLayeredWindowAttributes(form.Handle,out color,out alpha,out flags);
        var center=new Point(form.Left+form.Width/2,form.Top+form.Height/2);
        IntPtr hit=GetAncestor(WindowFromPoint(center),2);
        var name=new System.Text.StringBuilder(128);GetClassName(hit,name,name.Capacity);
        return new {handle=form.Handle.ToInt64(),exStyle=GetWindowLongPtr(form.Handle,-20).ToInt64().ToString("X"),
            opacity=form.Opacity,cloaked=cloaked,layered=layered,alpha=alpha,topWindow=hit.ToInt64(),topClass=name.ToString(),unobscured=hit==form.Handle};
    }
    public static bool Fullscreen(Rectangle screen,IntPtr own,IntPtr details) {
        int state;if(SHQueryUserNotificationState(out state)==0&&(state==3||state==4))return true;
        IntPtr foreground=GetForegroundWindow();if(foreground==IntPtr.Zero||foreground==own||foreground==details)return false;
        var name=new System.Text.StringBuilder(128);GetClassName(foreground,name,name.Capacity);
        if(name.ToString()=="Progman"||name.ToString()=="WorkerW"||name.ToString()=="Shell_TrayWnd")return false;
        Rect bounds;if(DwmGetWindowAttribute(foreground,9,out bounds,Marshal.SizeOf(typeof(Rect)))!=0&&!GetWindowRect(foreground,out bounds))return false;
        return CoversScreen(bounds.Box,screen);
    }
    public static Rectangle Anchor(Rectangle bar,Rectangle screen,int trayLeft,double scale,int cssWidth,int cssHeight) {
        int width=(int)Math.Ceiling(cssWidth*scale),height=(int)Math.Ceiling(cssHeight*scale);
        int left=Math.Max(screen.Left+4,Math.Min(trayLeft-width-(int)Math.Round(8*scale),screen.Right-width-4));
        int top=bar.Top+(bar.Height-height)/2;
        return new Rectangle(left,Math.Max(screen.Top+2,Math.Min(top,screen.Bottom-height-2)),width,height);
    }
    public static Rectangle PopupAnchor(Rectangle badge,Rectangle bar,Rectangle screen,double scale,int cssWidth,int cssHeight) {
        int width=(int)Math.Ceiling(cssWidth*scale),height=(int)Math.Ceiling(cssHeight*scale),gap=(int)Math.Round(10*scale);
        int x=Math.Max(screen.Left+8,Math.Min(badge.Left+(badge.Width-width)/2,screen.Right-width-8));
        int y=bar.Top>screen.Top+screen.Height/2?bar.Top-height-gap:bar.Bottom+gap;
        return new Rectangle(x,Math.Max(screen.Top+8,Math.Min(y,screen.Bottom-height-8)),width,height);
    }
    public static bool HiddenBar(Rectangle bar,Rectangle screen,bool automatic) {
        if(!automatic)return false;
        Rectangle intersection=Rectangle.Intersect(bar,screen);
        return intersection.IsEmpty||intersection.Height<=4||intersection.Width<=4;
    }
}

sealed class CardWindow : Form {
    public readonly WebView2 View=new WebView2();
    public readonly bool Details;
    public bool Ready;
    public int CssWidth,CssHeight;
    public double PixelRatio=1;
    public int ViewportWidth,ViewportHeight;
    public bool TextFits;
    public bool TimeFits;
    public object Indicators=new object[0];
    public string[] Labels=new string[0];
    public string Heading="";
    public bool Stale=true;
    public long UpdatedAt;
    readonly PanelController owner;
    public CardWindow(PanelController controller,bool details) {
        owner=controller;Details=details;CssWidth=details?240:72;CssHeight=details?170:38;
        Text=details?"QuotaRing Details":"QuotaRing";
        FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=controller.TestMode;TopMost=true;StartPosition=FormStartPosition.Manual;
        AutoScaleMode=AutoScaleMode.None;BackColor=Color.FromArgb(238,245,252);Opacity=0;
        View.Dock=DockStyle.Fill;View.DefaultBackgroundColor=BackColor;Controls.Add(View);
    }
    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get {var value=base.CreateParams;if(owner==null||!owner.TestMode)value.ExStyle|=0x08000080;if(Details)value.ClassStyle|=0x20000;return value;}}
    public void SizeAndPlace(Rectangle bounds,double scale) {
        if(Bounds==bounds)return;Bounds=bounds;
        IntPtr region=Native.CreateRoundRectRgn(0,0,Width+1,Height+1,(int)Math.Round(20*scale),(int)Math.Round(20*scale));
        var old=Region;Region=Region.FromHrgn(region);Native.DeleteObject(region);if(old!=null)old.Dispose();
    }
    public async Task Initialize() {
        try {
            await View.EnsureCoreWebView2Async(owner.Environment);
            var settings=View.CoreWebView2.Settings;settings.AreDevToolsEnabled=false;settings.AreDefaultContextMenusEnabled=false;
            settings.IsStatusBarEnabled=false;settings.IsZoomControlEnabled=false;
            View.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true;};
            View.CoreWebView2.PermissionRequested+=(s,e)=>{e.State=CoreWebView2PermissionState.Deny;};
            View.CoreWebView2.SetVirtualHostNameToFolderMapping("codex-usage-card.local",AppDomain.CurrentDomain.BaseDirectory,CoreWebView2HostResourceAccessKind.DenyCors);
            View.CoreWebView2.NavigationStarting+=(s,e)=>{if(e.Uri!="about:blank"&&!e.Uri.StartsWith(owner.PageUri,StringComparison.OrdinalIgnoreCase))e.Cancel=true;};
            View.CoreWebView2.WebMessageReceived+=(s,e)=>owner.Message(this,e.WebMessageAsJson);
            View.CoreWebView2.NavigationCompleted+=(s,e)=>{if(!e.IsSuccess&&View.Source!=null&&View.Source.AbsoluteUri.StartsWith(owner.PageUri,StringComparison.OrdinalIgnoreCase))owner.Fail("Navigation-"+e.WebErrorStatus.ToString());};
            View.Source=new Uri(owner.PageUri+(Details?"?view=details":"?view=badge"));
        } catch(Exception e) {owner.Fail(e.GetType().Name);}
    }
    public void Post(string json) {if(Ready&&View.CoreWebView2!=null)View.CoreWebView2.PostWebMessageAsJson(json);}
    protected override void Dispose(bool disposing) {if(disposing)View.Dispose();base.Dispose(disposing);}
}

sealed class PanelController : ApplicationContext {
    public CoreWebView2Environment Environment;
    public readonly string PageUri;
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly StreamWriter output=new StreamWriter(Console.OpenStandardOutput()){AutoFlush=true};
    readonly CardWindow badge,details;
    readonly Timer timer=new Timer();
    readonly TaskbarScanner scanner=new TaskbarScanner();
    readonly Process parent;
    readonly bool testMode;
    public bool TestMode {get{return testMode;}}
    string data=null,hiddenReason="starting",testScenario="",lastStatus="";
    bool detailsOpen=false,closing=false,dark=false;
    double scale=1,configuredHeight=-1;
    int ticks=0;
    Rectangle taskbarBounds;
    TaskbarSnapshot placementSnapshot,testSnapshot;
    string placementRegion="pending";
    public PanelController(string profile,int parentPid,bool testing) {
        testMode=testing;PageUri="https://codex-usage-card.local/panel.html";
        parent=Process.GetProcessById(parentPid);
        badge=new CardWindow(this,false);details=new CardWindow(this,true);MainForm=badge;
        badge.SizeAndPlace(new Rectangle(-2000,-2000,72,38),1);details.SizeAndPlace(new Rectangle(-2000,-2000,240,170),1);
        Start(profile);
    }
    async void Start(string profile) {
        try {
            Directory.CreateDirectory(profile);
            var options=new CoreWebView2EnvironmentOptions();
            Environment=await CoreWebView2Environment.CreateAsync(null,profile,options);
            badge.Show();details.Show();
            timer.Interval=100;timer.Tick+=(s,e)=>Tick();timer.Start();
            ReadInput();
            await badge.Initialize();await details.Initialize();
        } catch(Exception e){Fail(e.GetType().Name);}
    }
    async void ReadInput() {
        try {
            using(var input=new StreamReader(Console.OpenStandardInput())) {
                string line;
                while((line=await input.ReadLineAsync())!=null) {
                    var m=json.Deserialize<Dictionary<string,object>>(line);
                    string type=Convert.ToString(m["type"]);
                    if(type=="shutdown"){Shutdown();return;}
                    if(type=="usage"){data=line;badge.Post(data);details.Post(data);}
                    if(type=="test"&&testMode){testScenario=Convert.ToString(m["scenario"]);if(testScenario=="click")SetDetails(!detailsOpen);Tick();}
                    if(type=="test-layout"&&testMode){testSnapshot=TaskbarPlacement.SnapshotForTest(m);Tick();}
                    if(type=="test-layout-clear"&&testMode){testSnapshot=null;Tick();}
                }
            }
        }catch{}finally{Shutdown();}
    }
    public void Message(CardWindow window,string text) {
        try {
            var m=json.Deserialize<Dictionary<string,object>>(text);string type=Convert.ToString(m["type"]);
            if(type=="ready") {
                window.Ready=true;window.Post(json.Serialize(new {type="theme",dark=dark}));if(data!=null)window.Post(data);
            } else if(type=="toggle-details"&&!window.Details) {SetDetails(!detailsOpen);Tick();}
            else if(type=="close-details") {SetDetails(false);Tick();}
            else if(type=="layout") {
                window.CssWidth=Math.Max(20,Math.Min(500,Convert.ToInt32(m["width"])));
                window.CssHeight=Math.Max(8,Math.Min(500,Convert.ToInt32(m["height"])));
                if(m.ContainsKey("pixelRatio"))window.PixelRatio=Convert.ToDouble(m["pixelRatio"]);
                if(m.ContainsKey("viewportWidth"))window.ViewportWidth=Convert.ToInt32(m["viewportWidth"]);
                if(m.ContainsKey("viewportHeight"))window.ViewportHeight=Convert.ToInt32(m["viewportHeight"]);
                if(m.ContainsKey("textFits"))window.TextFits=Convert.ToBoolean(m["textFits"]);
                if(m.ContainsKey("timeFits"))window.TimeFits=Convert.ToBoolean(m["timeFits"]);
                if(m.ContainsKey("indicators"))window.Indicators=m["indicators"];
                var labels=m["labels"] as System.Collections.IEnumerable;
                if(labels!=null){var names=new List<string>();foreach(var name in labels)names.Add(Convert.ToString(name));window.Labels=names.ToArray();}
                window.Heading=Convert.ToString(m["title"]);window.Stale=Convert.ToBoolean(m["stale"]);
                if(m["updatedAt"]!=null)window.UpdatedAt=Convert.ToInt64(m["updatedAt"]);
                Tick();
            }
        } catch {Fail("InvalidPanelMessage");}
    }
    void Tick() {
        if(closing)return;
        try {
            if(parent.HasExited){Shutdown();return;}
            IntPtr taskbar=Native.FindWindow("Shell_TrayWnd",null);Native.Rect native;
            if(taskbar==IntPtr.Zero||!Native.GetWindowRect(taskbar,out native)){HideAll("taskbar-unavailable");return;}
            Rectangle bar=native.Box,screen=Screen.FromHandle(taskbar).Bounds;
            taskbarBounds=bar;
            // WebView2 can rasterize at 150% while the shell HWND reports 96 DPI.
            // Size our host in actual rendered CSS pixels, not the shell's DPI.
            scale=Math.Max(0.5,Math.Min(4,badge.PixelRatio));
            double availableHeight=Math.Max(8,(bar.Height-6)/scale);
            if(badge.Ready&&Math.Abs(availableHeight-configuredHeight)>.1){configuredHeight=availableHeight;badge.Post(json.Serialize(new {type="layout-config",height=availableHeight}));}
            var appbar=new Native.AppBar();appbar.Size=(uint)Marshal.SizeOf(typeof(Native.AppBar));appbar.Window=taskbar;
            bool automatic=(Native.SHAppBarMessage(4,ref appbar).ToUInt64()&1)!=0;
            if(testScenario=="fullscreen"||Native.Fullscreen(screen,badge.Handle,details.Handle)){HideAll("fullscreen");return;}
            if(testScenario=="taskbar-hidden"||!Native.IsWindowVisible(taskbar)||Native.HiddenBar(bar,screen,automatic)){HideAll("taskbar-hidden");return;}
            scanner.Request(taskbar,bar);
            placementSnapshot=testMode&&testSnapshot!=null?testSnapshot:scanner.Current(taskbar,bar);
            if(placementSnapshot==null){placementRegion="pending";HideAll("taskbar-layout-pending");return;}
            var size=new Size((int)Math.Ceiling(badge.CssWidth*scale),(int)Math.Ceiling(badge.CssHeight*scale));
            var position=TaskbarPlacement.Choose(placementSnapshot,screen,size,scale,badge.Bounds,out placementRegion);
            if(!position.HasValue){HideAll(placementRegion);return;}
            badge.SizeAndPlace(position.Value,scale);
            details.SizeAndPlace(Native.PopupAnchor(badge.Bounds,bar,screen,scale,details.CssWidth,details.CssHeight),scale);
            if(!testMode&&detailsOpen) {
                var point=Cursor.Position;
                if(((Native.GetAsyncKeyState(1)&0x8001)!=0&&!badge.Bounds.Contains(point)&&!details.Bounds.Contains(point))||(Native.GetAsyncKeyState(27)&1)!=0)SetDetails(false);
            }
            if(ticks++%50==0)UpdateTheme();
            hiddenReason=badge.Ready?"":"starting";
            if(badge.Ready){badge.Opacity=1;if(!badge.Visible)badge.Show();if(!Native.IsWindowVisible(badge.Handle))Native.ShowWindow(badge.Handle,4);Native.SetWindowPos(badge.Handle,new IntPtr(-1),0,0,0,0,0x13);}
            if(detailsOpen&&details.Ready){details.Opacity=1;if(!details.Visible)details.Show();if(!Native.IsWindowVisible(details.Handle))Native.ShowWindow(details.Handle,4);Native.SetWindowPos(details.Handle,new IntPtr(-1),0,0,0,0,0x13);}else if(details.Ready)details.Hide();
            Status();
        } catch(Exception e){Fail(e.GetType().Name);}
    }
    void UpdateTheme() {
        object value=Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize","SystemUsesLightTheme",1);
        dark=Convert.ToInt32(value)==0;
        badge.BackColor=details.BackColor=dark?Color.FromArgb(41,45,50):Color.FromArgb(238,245,252);
        badge.View.DefaultBackgroundColor=badge.BackColor;details.View.DefaultBackgroundColor=details.BackColor;
        string m=json.Serialize(new {type="theme",dark=dark});badge.Post(m);details.Post(m);
    }
    void SetDetails(bool open){detailsOpen=open;badge.Post(json.Serialize(new {type="details-state",open=open}));}
    void HideAll(string reason){hiddenReason=reason;SetDetails(false);badge.Hide();details.Hide();Status();}
    void Status(){var status=new {type="status",ready=badge.Ready&&details.Ready,visible=badge.Visible&&badge.Opacity>0,nativeVisible=Native.IsWindowVisible(badge.Handle),session=Process.GetCurrentProcess().SessionId,tooltipVisible=details.Visible&&details.Opacity>0,hiddenReason=hiddenReason,
        bounds=new {x=badge.Left,y=badge.Top,width=badge.Width,height=badge.Height},detailsBounds=new {x=details.Left,y=details.Top,width=details.Width,height=details.Height},
        taskbarBounds=new {x=taskbarBounds.Left,y=taskbarBounds.Top,width=taskbarBounds.Width,height=taskbarBounds.Height},
        placement=new {region=placementRegion,reliable=placementSnapshot!=null&&placementSnapshot.Reliable,source=testMode&&testSnapshot!=null?"test":"uia",occupied=placementSnapshot==null?new object[0]:Array.ConvertAll(placementSnapshot.Occupied,r=>TaskbarPlacement.Box(r))},
        labels=badge.Labels,indicators=badge.Indicators,badgeTimeFits=badge.TimeFits,title=badge.Heading,stale=badge.Stale,updatedAt=badge.UpdatedAt,dpi=(int)Math.Round(scale*96),theme=dark?"dark":"light",visibility=Native.Visibility(badge),
        rendering=new {windowDpi=Native.GetDpiForWindow(badge.Handle),badgePixelRatio=badge.PixelRatio,badgeViewport=new {width=badge.ViewportWidth,height=badge.ViewportHeight},badgeViewSize=new {width=badge.View.Width,height=badge.View.Height},badgeContent=new {width=badge.CssWidth,height=badge.CssHeight},badgeFits=badge.ViewportWidth>=badge.CssWidth-1&&badge.ViewportHeight>=badge.CssHeight-1,detailsPixelRatio=details.PixelRatio,detailsViewport=new {width=details.ViewportWidth,height=details.ViewportHeight},detailsViewSize=new {width=details.View.Width,height=details.View.Height},detailsContent=new {width=details.CssWidth,height=details.CssHeight},detailsFits=details.ViewportWidth>=details.CssWidth-1&&details.ViewportHeight>=details.CssHeight-1,detailsTextFits=details.TextFits}};string serialized=json.Serialize(status);if(serialized!=lastStatus){lastStatus=serialized;Emit(status);}}
    void Emit(object m){try{output.WriteLine(json.Serialize(m));}catch{Shutdown();}}
    public void Fail(string code){Emit(new {type="error",code=code,message=code=="WebView2RuntimeNotFoundException"?"缺少微软 WebView2 Runtime。请重新运行安装-Windows.cmd，按提示安装所需运行环境。":null});Shutdown();}
    async void Shutdown(){
        if(closing)return;closing=true;timer.Stop();scanner.Stop();MainForm=null;
        var exited=new TaskCompletionSource<bool>();
        EventHandler<CoreWebView2BrowserProcessExitedEventArgs> onExit=(s,e)=>exited.TrySetResult(true);
        if(Environment!=null)Environment.BrowserProcessExited+=onExit;else exited.TrySetResult(true);
        badge.Close();details.Close();badge.Dispose();details.Dispose();
        // Keep the message pump alive until WebView2 releases its private profile.
        await Task.WhenAny(exited.Task,Task.Delay(3500));
        if(Environment!=null)Environment.BrowserProcessExited-=onExit;
        timer.Dispose();parent.Dispose();ExitThread();
    }
}

static class Program {
    [STAThread] static int Main(string[] args) {
        if(Array.IndexOf(args,"--placement-test")>=0) {
            using(var input=new StreamReader(Console.OpenStandardInput()))
            using(var output=new StreamWriter(Console.OpenStandardOutput()))output.WriteLine(TaskbarPlacement.Evaluate(input.ReadToEnd()));
            return 0;
        }
        if(Array.IndexOf(args,"--self-test")>=0) {
            var screen=new Rectangle(0,0,1920,1080);var bar=new Rectangle(0,1032,1920,48);
            var position=Native.Anchor(bar,screen,1680,1,136,38);
            var largeBar=new Rectangle(0,1008,1920,72);var scaled=Native.Anchor(largeBar,screen,1680,1.5,136,38);
            var popup=Native.PopupAnchor(position,bar,screen,1,220,167);
            var rendered150=Native.Anchor(bar,screen,1680,1.5,138,28);var popup150=Native.PopupAnchor(rendered150,bar,screen,1.5,220,167);
            bool ok=position.Width==136&&position.Height==38&&position.Top>=bar.Top&&position.Bottom<=bar.Bottom&&
                popup.Bottom<position.Top&&popup.Left+popup.Width/2==position.Left+position.Width/2&&
                scaled.Width==204&&scaled.Height==57&&scaled.Top>=largeBar.Top&&scaled.Bottom<=largeBar.Bottom&&
                rendered150.Width==207&&rendered150.Height==42&&rendered150.Top>=bar.Top&&rendered150.Bottom<=bar.Bottom&&popup150.Width==330&&popup150.Height==251&&
                Native.HiddenBar(new Rectangle(0,1078,1920,48),screen,true)&&!Native.HiddenBar(bar,screen,true)&&
                Native.CoversScreen(screen,screen)&&!Native.CoversScreen(new Rectangle(0,0,1920,1032),screen);
            using(var stream=new StreamWriter(Console.OpenStandardOutput()))stream.WriteLine(ok?"layout-self-test: PASS":"layout-self-test: FAIL");return ok?0:1;
        }
        try {
            string profile=null;int parent=0;
            for(int i=0;i<args.Length;i++){if(args[i]=="--profile")profile=args[++i];else if(args[i]=="--parent")parent=int.Parse(args[++i]);}
            if(profile==null||parent<=0)return 2;
            Native.SetCurrentProcessExplicitAppUserModelID("CodexUsageCard.Taskbar");
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new PanelController(profile,parent,Array.IndexOf(args,"--test-host")>=0));return 0;
        } catch(Exception e){using(var stream=new StreamWriter(Console.OpenStandardOutput()))stream.WriteLine("{\"type\":\"error\",\"code\":\""+e.GetType().Name+"\"}");return 1;}
    }
}
